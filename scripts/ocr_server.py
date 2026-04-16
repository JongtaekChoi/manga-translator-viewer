"""만화 번역 서버.

comic-text-detector로 말풍선 위치 검출 → 각 crop을 OpenAI Vision에 multi-image로
1회 호출 → OCR + 번역을 LLM이 한 번에 수행 → inpainting + 한글 합성.

엔드포인트:
- POST /translate-render    검출 + 번역 + 렌더를 한 번에 (JPEG base64)
- POST /generate-context    작품명으로 컨텍스트 초안 생성
- GET  /health              상태 확인
"""

import base64
import io
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import cv2
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

CTD_DIR = os.path.join(os.path.dirname(__file__), '..', '.venv', 'comic-text-detector')
sys.path.insert(0, CTD_DIR)
from inference import TextDetector  # noqa: E402

# .env 로드
_env_path = Path(__file__).resolve().parent.parent / '.env'
if _env_path.exists():
    for line in _env_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
FONT_PATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'

print("Loading comic-text-detector model...", flush=True)
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
ctd_model_path = os.path.join(CTD_DIR, 'data', 'comictextdetector.pt')

# conf_thresh 낮추면 검출 더 공격적으로 (0.4는 기본이지만 색만화/특수 스타일 놓침)
# env var CTD_CONF_THRESH로 오버라이드 가능
CTD_CONF_THRESH = float(os.environ.get('CTD_CONF_THRESH', 0.25))
CTD_NMS_THRESH = float(os.environ.get('CTD_NMS_THRESH', 0.35))

ctd = TextDetector(
    model_path=ctd_model_path,
    input_size=1024,
    device=device,
    act='leaky',
    conf_thresh=CTD_CONF_THRESH,
    nms_thresh=CTD_NMS_THRESH,
)
print(f"comic-text-detector ready (device={device}, conf={CTD_CONF_THRESH}, nms={CTD_NMS_THRESH}).", flush=True)


# ─── 유틸 ───

def download_image(url, referer=None):
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    if referer:
        headers["Referer"] = referer
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=15) as resp:
            data = resp.read()
    except Exception as e:
        print(f"[download] FAILED {url[:100]}: {e}", flush=True)
        return None

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    # 디버그: 다운로드 정보 로깅 + 마지막 다운로드 이미지를 /tmp에 저장
    if img is not None:
        import tempfile
        debug_path = os.path.join(tempfile.gettempdir(), 'mtl_last_download.jpg')
        try:
            with open(debug_path, 'wb') as f:
                f.write(data)
        except Exception:
            pass
        print(f"[download] {len(data)}B  shape={img.shape}  saved={debug_path}  url={url[:80]}", flush=True)
    else:
        print(f"[download] decode failed  {len(data)}B  url={url[:100]}", flush=True)
    return img


def _bbox_iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    return inter / (area_a + area_b - inter)


def _dedupe_bboxes(blk_list, iou_threshold=0.3):
    """겹치는 bbox 제거 (큰 것 우선 보존)."""
    sorted_blks = sorted(
        blk_list,
        key=lambda b: -((b.xyxy[2] - b.xyxy[0]) * (b.xyxy[3] - b.xyxy[1]))
    )
    kept = []
    for blk in sorted_blks:
        box = tuple(float(v) for v in blk.xyxy)
        if any(_bbox_iou(box, tuple(float(v) for v in e.xyxy)) > iou_threshold for e in kept):
            continue
        kept.append(blk)
    return kept


# ─── 검출 + 크롭 ───

def detect_and_crop(img_cv):
    """CTD 검출 + dedup + 읽는 순서 정렬 + crop.
    첫 시도에서 0개 검출되면 임계값을 더 낮춰서 1회 재시도."""
    t0 = time.time()
    h, w = img_cv.shape[:2]

    mask, _, blk_list = ctd(img_cv)

    # 0개면 임계값 더 낮춰서 재시도 (공격적 검출)
    if len(blk_list) == 0:
        orig_conf = ctd.conf_thresh
        ctd.conf_thresh = 0.1
        try:
            mask, _, blk_list = ctd(img_cv)
            print(f"[ctd] retry with conf=0.1  detections={len(blk_list)}", flush=True)
        finally:
            ctd.conf_thresh = orig_conf

    t_ctd = time.time() - t0

    blk_list = _dedupe_bboxes(blk_list, iou_threshold=0.3)
    row_h = max(h // 5, 1)
    blk_list.sort(key=lambda blk: (blk.xyxy[1] // row_h, -blk.xyxy[0]))

    detections = []
    for blk in blk_list:
        x1, y1, x2, y2 = [int(v) for v in blk.xyxy]
        pad = 3
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
        crop = img_cv[y1:y2, x1:x2]
        if crop.size == 0:
            continue
        pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        detections.append({
            "crop": pil,
            "coords": (x1, y1, x2, y2),
            "box": {
                "x": round(x1 / w * 100, 2),
                "y": round(y1 / h * 100, 2),
                "w": round((x2 - x1) / w * 100, 2),
                "h": round((y2 - y1) / h * 100, 2),
            },
        })

    print(f"[timing] ctd={t_ctd:.2f}s  detections={len(detections)}", flush=True)
    return detections, mask


# ─── OpenAI Vision 번역 ───

def translate_crops_vision(crops_pil, context='', model=None):
    """각 풍선 crop을 multi-image 1회 호출로 보내 OCR + 번역.
    returns: [{text, ko}, ...] (길이는 입력과 동일)"""
    import urllib.request

    if not crops_pil:
        return []
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인)")

    system_parts = [
        "만화 번역 전문가. 여러 장의 말풍선 crop 이미지가 순서대로 주어진다 (#1, #2, ...).",
        "각 이미지 안의 일본어 텍스트를 읽고 한국어로 번역한다.",
        "",
        "규칙:",
        "- 캐릭터의 말투와 감정을 살려 자연스럽게 번역",
        "- 효과음은 그대로 음역 (예: ドォン → 두웅)",
        "- 한 crop에 여러 텍스트가 있으면 읽는 순서대로 이어서 하나로 합침",
        "- 텍스트가 없거나 읽기 어려우면 text/ko 모두 빈 문자열",
        "",
        "반드시 아래 JSON 형식으로만 응답:",
        '{"texts": [{"text": "日本語", "ko": "한국어"}, ...]}',
        f"배열 길이는 반드시 입력 이미지 개수({len(crops_pil)})와 일치.",
    ]
    if context:
        system_parts.append(f"\n[작품 정보]\n{context}")

    user_content = [
        {"type": "text", "text": f"아래 {len(crops_pil)}개 말풍선을 순서대로 읽고 번역해주세요."}
    ]
    for i, pil in enumerate(crops_pil, 1):
        buf = io.BytesIO()
        pil.save(buf, format="JPEG", quality=90)
        b64 = base64.b64encode(buf.getvalue()).decode()
        user_content.append({"type": "text", "text": f"#{i}"})
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}
        })

    body = json.dumps({
        "model": model or OPENAI_MODEL,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "\n".join(system_parts)},
            {"role": "user", "content": user_content}
        ]
    }).encode()

    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=body,
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json'
        }
    )
    with urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())

    raw = data.get('choices', [{}])[0].get('message', {}).get('content', '{}')
    try:
        parsed = json.loads(raw)
    except Exception as e:
        print(f"[vision] JSON parse failed: {e}  raw={raw[:300]}", flush=True)
        parsed = {}

    # texts/bubbles/result 등 대안 키 허용
    texts = []
    if isinstance(parsed, dict):
        for key in ('texts', 'bubbles', 'results', 'translations'):
            if isinstance(parsed.get(key), list):
                texts = parsed[key]
                break
    elif isinstance(parsed, list):
        texts = parsed

    out = []
    for i in range(len(crops_pil)):
        t = texts[i] if i < len(texts) and isinstance(texts[i], dict) else {}
        out.append({
            "text": str(t.get('text', '')),
            "ko": str(t.get('ko', '')),
        })

    non_empty = sum(1 for x in out if x['ko'])
    if non_empty == 0 and crops_pil:
        print(f"[vision] all ko empty for {len(crops_pil)} crops.  raw={raw[:500]}", flush=True)
    else:
        print(f"[vision] {non_empty}/{len(crops_pil)} translated", flush=True)

    return out


# ─── Full-page Vision fallback (CTD가 0개 검출했을 때) ───

def translate_full_page_vision(img_cv, context='', model=None):
    """CTD 실패 시 폴백: 전체 이미지를 GPT Vision에 보내 bbox + OCR + 번역을 한 번에 수행.
    bbox 정확도는 CTD+크롭 방식보다 떨어지므로 최후의 수단."""
    import urllib.request

    if not OPENAI_API_KEY:
        return []

    # 원본 해상도 그대로 JPEG 인코딩 (detail:high로 OpenAI가 내부에서 타일링)
    ok, jpg = cv2.imencode('.jpg', img_cv, [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        return []
    b64 = base64.b64encode(jpg.tobytes()).decode()

    system_parts = [
        "만화 이미지 분석 및 번역 전문가. 이미지의 모든 말풍선/대사/효과음을 찾아 일본어를 읽고 한국어로 번역한다.",
        "",
        "규칙:",
        "- 모든 텍스트 영역의 위치를 이미지 좌상단 기준 백분율(%)로 반환",
        "- 캐릭터의 말투와 감정을 살려 자연스럽게 번역",
        "- 효과음은 그대로 음역 (예: ドォン → 두웅)",
        "- 읽는 순서(오른쪽→왼쪽, 위→아래)로 정렬",
        "- 텍스트가 없으면 빈 배열 반환",
        "",
        "반드시 아래 JSON 형식으로만 응답:",
        '{"bubbles": [{"text": "日本語", "ko": "한국어", "box": {"x": 10.5, "y": 20.3, "w": 15.2, "h": 12.8}}]}',
        "box 설명: x=왼쪽위 X%, y=왼쪽위 Y%, w=너비%, h=높이%",
    ]
    if context:
        system_parts.append(f"\n[작품 정보]\n{context}")

    body = json.dumps({
        "model": model or OPENAI_MODEL,
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": "\n".join(system_parts)},
            {"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"}},
                {"type": "text", "text": "이 만화 페이지의 모든 텍스트를 찾아 한국어로 번역해주세요. JSON으로만 응답."}
            ]}
        ]
    }).encode()

    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=body,
        headers={
            'Authorization': f'Bearer {OPENAI_API_KEY}',
            'Content-Type': 'application/json'
        }
    )
    with urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())

    raw = data.get('choices', [{}])[0].get('message', {}).get('content', '{}')
    try:
        parsed = json.loads(raw)
    except Exception as e:
        print(f"[full-page-vision] JSON parse failed: {e}  raw={raw[:300]}", flush=True)
        return []

    bubbles = parsed.get('bubbles', []) if isinstance(parsed, dict) else []

    def clamp(v):
        try:
            return max(0.0, min(100.0, float(v)))
        except Exception:
            return 0.0

    out = []
    for b in bubbles:
        if not isinstance(b, dict):
            continue
        ko = str(b.get('ko', ''))
        if not ko:
            continue
        box = b.get('box', {}) or {}
        out.append({
            'text': str(b.get('text', '')),
            'ko': ko,
            'box': {
                'x': clamp(box.get('x', 0)),
                'y': clamp(box.get('y', 0)),
                'w': clamp(box.get('w', 0)),
                'h': clamp(box.get('h', 0)),
            }
        })

    print(f"[full-page-vision] {len(out)} bubbles found", flush=True)
    return out


# ─── 이미지 합성 ───

def wrap_text(draw, text, font, max_width):
    """공백 단위로 줄바꿈. 한 단어가 max_width보다 길면 문자 단위로 쪼갬."""
    def tw(s):
        bbox = draw.textbbox((0, 0), s, font=font)
        return bbox[2] - bbox[0]

    def break_long_word(word):
        chunks, buf = [], ""
        for ch in word:
            test = buf + ch
            if tw(test) > max_width and buf:
                chunks.append(buf)
                buf = ch
            else:
                buf = test
        if buf:
            chunks.append(buf)
        return chunks

    lines = []
    current = ""
    for word in text.split(" "):
        if not word:
            continue
        candidate = word if not current else current + " " + word
        if tw(candidate) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        if tw(word) > max_width:
            chunks = break_long_word(word)
            lines.extend(chunks[:-1])
            current = chunks[-1] if chunks else ""
        else:
            current = word

    if current:
        lines.append(current)
    return lines


def fit_text(draw, text, box_w, box_h, font_path):
    """가로쓰기 + 줄바꿈. 들어가는 최대 폰트 크기 선택."""
    for size in range(24, 7, -1):
        try:
            font = ImageFont.truetype(font_path, size)
        except Exception:
            continue
        lines = wrap_text(draw, text, font, box_w - 4)
        if len(lines) * (size + 3) <= box_h:
            return font, "\n".join(lines), size
    font = ImageFont.truetype(font_path, 8)
    lines = wrap_text(draw, text, font, box_w - 4)
    return font, "\n".join(lines), 8


def export_image(img_cv, mask, bubbles_with_ko):
    h, w = img_cv.shape[:2]

    if mask is not None and mask.shape[:2] == (h, w):
        mask_bin = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)[1]
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask_dilated = cv2.dilate(mask_bin, kernel, iterations=1)
        inpainted = cv2.inpaint(img_cv, mask_dilated, 3, cv2.INPAINT_TELEA)
    else:
        inpainted = img_cv.copy()

    pil_img = Image.fromarray(cv2.cvtColor(inpainted, cv2.COLOR_BGR2RGB))
    draw = ImageDraw.Draw(pil_img)

    for b in bubbles_with_ko:
        ko = b.get("ko", "")
        if not ko:
            continue
        box = b["box"]
        x = int(box["x"] / 100 * w)
        y = int(box["y"] / 100 * h)
        bw = int(box["w"] / 100 * w)
        bh = int(box["h"] / 100 * h)
        if bw < 10 or bh < 10:
            continue

        font, fitted_text, font_size = fit_text(draw, ko, bw, bh, FONT_PATH)

        line_h = font_size + 3
        lines = fitted_text.split("\n")
        total_h = len(lines) * line_h
        start_y = y + (bh - total_h) // 2
        for i, line in enumerate(lines):
            bbox = draw.textbbox((0, 0), line, font=font)
            line_w = bbox[2] - bbox[0]
            tx = x + (bw - line_w) // 2
            ty = start_y + i * line_h
            draw.text((tx, ty), line, fill="black", font=font)

    return pil_img


# ─── HTTP Handler ───

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors_headers()
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/health':
            self._json(200, {"status": "ok", "openai": bool(OPENAI_API_KEY)})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/translate-render":
            self._handle_translate_render(body)
        elif self.path == "/generate-context":
            self._handle_generate_context(body)
        else:
            self.send_error(404)

    def _handle_translate_render(self, body):
        image_url = body.get("imageUrl", "")
        context = body.get("context", "")
        model = body.get("model", "")
        referer = body.get("referer", "")
        if not image_url:
            self._json(400, {"error": "imageUrl is required"})
            return
        try:
            t0 = time.time()
            img_cv = download_image(image_url, referer=referer)
            t_dl = time.time() - t0
            if img_cv is None:
                self._json(500, {"error": "failed to decode image"})
                return

            detections, mask = detect_and_crop(img_cv)

            t1 = time.time()
            fallback_used = False
            if not detections:
                # CTD 실패 → 전체 페이지를 GPT Vision에 맡김
                print(f"[translate-render] CTD detected 0 bubbles, using full-page Vision fallback", flush=True)
                translated = translate_full_page_vision(img_cv, context, model)
                fallback_used = True
                mask = None  # inpainting 불가 (crop 기반 마스크 없음)
            else:
                crops = [d["crop"] for d in detections]
                tks = translate_crops_vision(crops, context, model)
                translated = []
                for d, tk in zip(detections, tks):
                    if not tk.get("ko"):
                        continue
                    translated.append({
                        "text": tk.get("text", ""),
                        "ko": tk.get("ko", ""),
                        "box": d["box"],
                    })
            t_tr = time.time() - t1

            if not translated:
                print(f"[translate-render] no usable translations (fallback={fallback_used})", flush=True)
                self._json(200, {"bubbles": [], "rendered": None})
                return

            t2 = time.time()
            result = export_image(img_cv, mask, translated)
            buf = io.BytesIO()
            result.save(buf, format="JPEG", quality=92)
            b64 = base64.b64encode(buf.getvalue()).decode()
            t_render = time.time() - t2

            print(
                f"[timing] download={t_dl:.2f}s  translate={t_tr:.2f}s  "
                f"render={t_render:.2f}s  total={time.time()-t0:.2f}s",
                flush=True,
            )
            self._json(200, {
                "bubbles": translated,
                "rendered": f"data:image/jpeg;base64,{b64}",
            })
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_generate_context(self, body):
        work_name = body.get("workName", "").strip()
        model = body.get("model", "")
        if not work_name:
            self._json(400, {"error": "workName is required"})
            return
        if not OPENAI_API_KEY:
            self._json(400, {"error": "OpenAI API key not set"})
            return

        try:
            import urllib.request
            prompt = f"""만화/웹툰 "{work_name}"의 번역에 필요한 정보를 정리해줘.

아래 항목을 포함해서 간결하게 작성:
1. 주요 캐릭터 이름 (일본어 → 한국어 공식 명칭)
2. 주요 용어/고유명사 (일본어 → 한국어)
3. 캐릭터별 말투 특징 (반말/존댓말, 특유의 어투)
4. 세계관 핵심 설정 (한 줄 요약)

간결하게, 번역 참고용으로만 작성해."""

            req_body = json.dumps({
                "model": model or OPENAI_MODEL,
                "temperature": 0.3,
                "messages": [{"role": "user", "content": prompt}]
            }).encode()

            req = urllib.request.Request(
                'https://api.openai.com/v1/chat/completions',
                data=req_body,
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                }
            )
            with urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())

            context = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            self._json(200, {"context": context})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[server] {fmt % args}", flush=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8789
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"Server listening on :{port}", flush=True)
    server.serve_forever()
