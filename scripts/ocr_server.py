"""manga_ocr OCR 서버 — 패널 분할 + 텍스트 영역 위치 반환.

1) 흰색 구분선 기반 패널 분할
2) 패널 내에서 밝은 영역(말풍선 후보) 검출 시도
3) 각 영역 OCR → 일본어 텍스트만 반환
4) 바운딩 박스를 퍼센트 좌표로 반환
"""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.request import urlopen, Request

import cv2
import numpy as np
from PIL import Image
from manga_ocr import MangaOcr

print("Loading manga_ocr model...", flush=True)
mocr = MangaOcr()
print("manga_ocr model ready.", flush=True)


def is_japanese(text):
    for ch in text:
        cp = ord(ch)
        if (0x3040 <= cp <= 0x309F or
            0x30A0 <= cp <= 0x30FF or
            0x4E00 <= cp <= 0x9FFF or
            0xFF66 <= cp <= 0xFF9F):
            return True
    return False


def find_panels(gray, h, w):
    """흰색 구분선 기반으로 패널(칸) 분할."""
    row_means = np.mean(gray, axis=1)
    white_rows = row_means > 235

    h_splits = [0]
    in_white = False
    for y in range(h):
        if white_rows[y] and not in_white:
            in_white = True
            split_start = y
        elif not white_rows[y] and in_white:
            in_white = False
            mid = (split_start + y) // 2
            if mid > h_splits[-1] + h * 0.06:
                h_splits.append(mid)
    h_splits.append(h)

    panels = []
    for i in range(len(h_splits) - 1):
        y1, y2 = h_splits[i], h_splits[i + 1]
        if y2 - y1 < h * 0.04:
            continue
        strip = gray[y1:y2, :]

        col_means = np.mean(strip, axis=0)
        white_cols = col_means > 235

        v_splits = [0]
        in_white_v = False
        for x in range(w):
            if white_cols[x] and not in_white_v:
                in_white_v = True
                vs_start = x
            elif not white_cols[x] and in_white_v:
                in_white_v = False
                mid = (vs_start + x) // 2
                if mid > v_splits[-1] + w * 0.06:
                    v_splits.append(mid)
        v_splits.append(w)

        for j in range(len(v_splits) - 1):
            x1, x2 = v_splits[j], v_splits[j + 1]
            if x2 - x1 < w * 0.04:
                continue
            panels.append((x1, y1, x2, y2))

    if len(panels) < 2:
        panels = [(0, 0, w, h)]

    return panels


def find_bright_regions(gray, x1, y1, x2, y2):
    """패널 내에서 밝은 영역(말풍선 후보)을 검출.
    찾으면 해당 영역 리스트, 못 찾으면 빈 리스트 반환."""
    roi = gray[y1:y2, x1:x2]
    rh, rw = roi.shape

    if rh < 20 or rw < 20:
        return []

    _, binary = cv2.threshold(roi, 190, 255, cv2.THRESH_BINARY)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=4)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    min_area = rh * rw * 0.02   # 패널의 2%
    max_area = rh * rw * 0.7

    regions = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < min_area or area > max_area:
            continue

        rx, ry, rbw, rbh = cv2.boundingRect(cnt)
        # 너무 납작하거나 가늘면 스킵
        if rbw < 15 or rbh < 15:
            continue

        sub_roi = roi[ry:ry+rbh, rx:rx+rbw]
        if sub_roi.size == 0:
            continue
        mean_val = np.mean(sub_roi)
        if mean_val < 140:
            continue

        # 절대 좌표로 변환
        regions.append((x1 + rx, y1 + ry, x1 + rx + rbw, y1 + ry + rbh))

    return regions


def ocr_bubbles(img_cv):
    """패널 분할 → 밝은 영역 검출 → OCR."""
    h, w = img_cv.shape[:2]
    gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)

    panels = find_panels(gray, h, w)

    # 읽기 순서: 위→아래, 오른→왼
    row_h = max(h // 5, 1)
    panels.sort(key=lambda b: ((b[1]) // row_h, -(b[0])))

    results = []
    seen = set()

    for px1, py1, px2, py2 in panels:
        # 패널 내에서 밝은 영역(말풍선) 찾기
        bright = find_bright_regions(gray, px1, py1, px2, py2)

        if bright:
            # 밝은 영역을 읽기 순서로 정렬
            bright.sort(key=lambda b: ((b[1] - py1) // max((py2 - py1) // 3, 1), -(b[0])))
            for bx1, by1, bx2, by2 in bright:
                crop = img_cv[by1:by2, bx1:bx2]
                if crop.size == 0:
                    continue
                pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                text = mocr(pil).strip()
                if text and is_japanese(text) and text not in seen:
                    seen.add(text)
                    results.append({
                        "text": text,
                        "box": {
                            "x": round(bx1 / w * 100, 2),
                            "y": round(by1 / h * 100, 2),
                            "w": round((bx2 - bx1) / w * 100, 2),
                            "h": round((by2 - by1) / h * 100, 2),
                        }
                    })
        else:
            # 밝은 영역 못 찾으면 패널 전체 OCR
            crop = img_cv[py1:py2, px1:px2]
            if crop.size == 0:
                continue
            pil = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            text = mocr(pil).strip()
            if text and is_japanese(text) and text not in seen:
                seen.add(text)
                results.append({
                    "text": text,
                    "box": {
                        "x": round(px1 / w * 100, 2),
                        "y": round(py1 / h * 100, 2),
                        "w": round((px2 - px1) / w * 100, 2),
                        "h": round((py2 - py1) / h * 100, 2),
                    }
                })

    return results


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/ocr":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        image_url = body.get("imageUrl", "")

        if not image_url:
            self._json(400, {"error": "imageUrl is required"})
            return

        try:
            req = Request(image_url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(req, timeout=15) as resp:
                arr = np.frombuffer(resp.read(), dtype=np.uint8)
                img_cv = cv2.imdecode(arr, cv2.IMREAD_COLOR)

            if img_cv is None:
                self._json(500, {"error": "failed to decode image"})
                return

            bubbles = ocr_bubbles(img_cv)
            all_text = "\n".join(b["text"] for b in bubbles)
            self._json(200, {"bubbles": bubbles, "text": all_text})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[ocr] {fmt % args}", flush=True)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8789
    server = HTTPServer(("127.0.0.1", port), Handler)
    print(f"OCR server listening on :{port}", flush=True)
    server.serve_forever()
