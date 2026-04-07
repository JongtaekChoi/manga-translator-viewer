"""만화 번역 올인원 서버.

- /ocr: comic-text-detector + manga_ocr로 텍스트 검출 + OCR
- /translate: OCR + 번역 (OpenAI or Google Translate)
- /export: 번역된 이미지 합성
- /proxy-image: CORS 우회 이미지 프록시
"""

import io
import json
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request
from urllib.parse import urlparse, parse_qs

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from manga_ocr import MangaOcr

CTD_DIR = os.path.join(os.path.dirname(__file__), '..', '.venv', 'comic-text-detector')
sys.path.insert(0, CTD_DIR)
from inference import TextDetector

# 환경변수
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-4o-mini')
FONT_PATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'

print("Loading manga_ocr model...", flush=True)
mocr = MangaOcr()
print("manga_ocr model ready.", flush=True)

print("Loading comic-text-detector model...", flush=True)
import torch
device = 'mps' if torch.backends.mps.is_available() else 'cpu'
ctd_model_path = os.path.join(CTD_DIR, 'data', 'comictextdetector.pt')
ctd = TextDetector(model_path=ctd_model_path, input_size=1024, device=device, act='leaky')
print(f"comic-text-detector ready (device={device}).", flush=True)


# ─── 유틸 ───

def is_japanese(text):
    for ch in text:
        cp = ord(ch)
        if (0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF or
            0x4E00 <= cp <= 0x9FFF or 0xFF66 <= cp <= 0xFF9F):
            return True
    return False


def download_image(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=15) as resp:
        arr = np.frombuffer(resp.read(), dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def download_image_bytes(url):
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=15) as resp:
        ct = resp.headers.get('Content-Type', 'image/jpeg')
        data = resp.read()
        return data, ct


# ─── OCR ───

def ocr_bubbles(img_cv):
    h, w = img_cv.shape[:2]
    mask, mask_refined, blk_list = ctd(img_cv)

    row_h = max(h // 5, 1)
    blk_list.sort(key=lambda blk: (blk.xyxy[1] // row_h, -blk.xyxy[0]))

    results = []
    seen = set()

    for blk in blk_list:
        x1, y1, x2, y2 = [int(v) for v in blk.xyxy]
        pad = 3
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(w, x2 + pad), min(h, y2 + pad)

        crop = img_cv[y1:y2, x1:x2]
        if crop.size == 0:
            continue

        pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        text = mocr(pil).strip()

        if not text or not is_japanese(text) or text in seen:
            continue

        seen.add(text)
        results.append({
            "text": text,
            "box": {
                "x": round(x1 / w * 100, 2),
                "y": round(y1 / h * 100, 2),
                "w": round((x2 - x1) / w * 100, 2),
                "h": round((y2 - y1) / h * 100, 2),
            }
        })

    return results, mask


# ─── 번역 ───

def translate_google(text):
    import urllib.parse
    params = urllib.parse.urlencode({
        'client': 'gtx', 'sl': 'ja', 'tl': 'ko', 'dt': 't', 'q': text
    })
    url = f'https://translate.googleapis.com/translate_a/single?{params}'
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if isinstance(data, list) and isinstance(data[0], list):
        return ''.join(x[0] for x in data[0] if x[0])
    return ''


def translate_openai(bubbles, image_url=None):
    import urllib.request
    numbered = '\n'.join(f'{i+1}. {b["text"]}' for i, b in enumerate(bubbles))

    user_content = [
        {"type": "text", "text": f"이 만화 페이지에서 OCR로 추출한 대사 목록이야. 이미지의 장면과 맥락을 참고해서 번역해줘.\n\n{numbered}"}
    ]

    # 이미지 첨부 (Vision)
    if image_url:
        try:
            img_data, ct = download_image_bytes(image_url)
            import base64
            b64 = base64.b64encode(img_data).decode()
            user_content.insert(0, {
                "type": "image_url",
                "image_url": {"url": f"data:{ct};base64,{b64}", "detail": "low"}
            })
        except Exception:
            pass

    body = json.dumps({
        "model": OPENAI_MODEL,
        "temperature": 0.3,
        "messages": [
            {
                "role": "system",
                "content": "만화 대사 번역가. 일본어 만화 대사를 한국어로 자연스럽게 번역한다.\n- 이미지의 장면, 캐릭터 표정, 상황을 참고하여 맥락에 맞게 번역\n- 캐릭터의 말투와 감정을 살려서 번역\n- 의역보다는 원문의 뉘앙스를 유지하되 한국어로 자연스럽게\n- 효과음이나 의미없는 텍스트는 그대로 음역\n- 출력: 번호와 번역만. 설명 없이.\n- 형식: 각 줄에 \"번호. 번역\""
            },
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
    with urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())

    raw = data.get('choices', [{}])[0].get('message', {}).get('content', '')
    ko_map = {}
    for line in raw.split('\n'):
        import re
        m = re.match(r'^(\d+)\.\s*(.+)', line)
        if m:
            ko_map[int(m.group(1))] = m.group(2).strip()

    return [
        {**b, "ko": ko_map.get(i + 1, '')}
        for i, b in enumerate(bubbles)
    ]


def translate_bubbles(bubbles, image_url=None):
    if OPENAI_API_KEY:
        try:
            return translate_openai(bubbles, image_url)
        except Exception as e:
            print(f"[translate] OpenAI failed, falling back to Google: {e}", flush=True)

    result = []
    for b in bubbles:
        try:
            ko = translate_google(b["text"])
        except Exception:
            ko = ''
        result.append({**b, "ko": ko})
    return result


# ─── 이미지 합성 ───

def fit_text(draw, text, box_w, box_h, font_path):
    vertical = box_h > box_w * 1.5
    for size in range(24, 7, -1):
        try:
            font = ImageFont.truetype(font_path, size)
        except Exception:
            continue
        if vertical:
            char_h = size + 2
            chars_per_col = max(box_h // char_h, 1)
            cols_needed = (len(text) + chars_per_col - 1) // chars_per_col
            col_w = size + 4
            if cols_needed * col_w <= box_w:
                return font, text, size, True
        else:
            lines = wrap_text(draw, text, font, box_w - 4)
            if len(lines) * (size + 3) <= box_h:
                return font, "\n".join(lines), size, False
    font = ImageFont.truetype(font_path, 8)
    return font, text[:10], 8, False


def wrap_text(draw, text, font, max_width):
    lines, current = [], ""
    for ch in text:
        test = current + ch
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(current)
            current = ch
        else:
            current = test
    if current:
        lines.append(current)
    return lines


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

        font, fitted_text, font_size, is_vertical = fit_text(draw, ko, bw, bh, FONT_PATH)

        if is_vertical:
            char_h = font_size + 2
            col_w = font_size + 4
            chars_per_col = max(bh // char_h, 1)
            chars = list(fitted_text)
            col_idx = char_idx = 0
            while char_idx < len(chars):
                cx = x + bw - (col_idx + 1) * col_w + 2
                cy = y + 2
                for _ in range(chars_per_col):
                    if char_idx >= len(chars):
                        break
                    draw.text((cx, cy), chars[char_idx], fill="black", font=font)
                    cy += char_h
                    char_idx += 1
                col_idx += 1
        else:
            line_h = font_size + 3
            lines = fitted_text.split("\n")
            total_h = len(lines) * line_h
            start_y = y + (bh - total_h) // 2
            for i, line in enumerate(lines):
                bbox = draw.textbbox((0, 0), line, font=font)
                tw = bbox[2] - bbox[0]
                tx = x + (bw - tw) // 2
                ty = start_y + i * line_h
                draw.text((tx, ty), line, fill="black", font=font)

    return pil_img


# ─── HTTP 핸들러 ───

class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors_headers()
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/proxy-image':
            qs = parse_qs(parsed.query)
            url = qs.get('url', [''])[0]
            if not url:
                self._json(400, {"error": "url required"})
                return
            try:
                data, ct = download_image_bytes(url)
                self.send_response(200)
                self._cors_headers()
                self.send_header("Content-Type", ct)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._json(500, {"error": str(e)})
        elif parsed.path == '/health':
            self._json(200, {"status": "ok", "openai": bool(OPENAI_API_KEY)})
        else:
            self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}

        if self.path == "/ocr":
            self._handle_ocr(body)
        elif self.path == "/translate":
            self._handle_translate(body)
        elif self.path == "/export":
            self._handle_export(body)
        else:
            self.send_error(404)

    def _handle_ocr(self, body):
        image_url = body.get("imageUrl", "")
        if not image_url:
            self._json(400, {"error": "imageUrl is required"})
            return
        try:
            img_cv = download_image(image_url)
            if img_cv is None:
                self._json(500, {"error": "failed to decode image"})
                return
            bubbles, _ = ocr_bubbles(img_cv)
            self._json(200, {"bubbles": bubbles, "text": "\n".join(b["text"] for b in bubbles)})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_translate(self, body):
        image_url = body.get("imageUrl", "")
        if not image_url:
            self._json(400, {"error": "imageUrl is required"})
            return
        try:
            img_cv = download_image(image_url)
            if img_cv is None:
                self._json(500, {"error": "failed to decode image"})
                return
            bubbles, _ = ocr_bubbles(img_cv)
            if not bubbles:
                self._json(200, {"bubbles": [], "text": ""})
                return
            translated = translate_bubbles(bubbles, image_url)
            self._json(200, {
                "bubbles": translated,
                "text": "\n".join(b.get("ko", "") for b in translated)
            })
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_export(self, body):
        image_url = body.get("imageUrl", "")
        bubbles = body.get("bubbles", [])
        if not image_url:
            self._json(400, {"error": "imageUrl is required"})
            return
        try:
            img_cv = download_image(image_url)
            if img_cv is None:
                self._json(500, {"error": "failed to decode image"})
                return
            mask, _, _ = ctd(img_cv)
            result = export_image(img_cv, mask, bubbles)
            buf = io.BytesIO()
            result.save(buf, format="JPEG", quality=92)
            data = buf.getvalue()
            self.send_response(200)
            self._cors_headers()
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
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
