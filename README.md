# manga-translator-viewer

일본 만화 URL을 입력하면 이미지를 수집하고, 말풍선을 자동 검출하여 한국어 번역을 오버레이로 보여주는 웹 뷰어.

## 아키텍처

```
Vite + React (프론트)  ←→  Express API 서버  ←→  manga_ocr (Python OCR 서버)
    :5174                     :8788                    :8789
                                ↕
                         Google Translate
```

- **manga_ocr** — 만화 특화 OCR 모델 (kha-white/manga-ocr-base). OpenCV로 패널 분할 + 말풍선 영역 검출 후 각각 OCR 수행
- **Google Translate** — 추출된 일본어 텍스트를 한국어로 번역
- **오버레이** — 말풍선 바운딩 박스 좌표를 퍼센트로 반환하여 이미지 위에 번역 div 표시

## 설치 & 실행

```bash
# Node 의존성
npm install

# Python venv + manga_ocr 설치
python3 -m venv .venv
.venv/bin/pip install manga-ocr opencv-python-headless

# 개발 서버 실행 (Vite + Express + OCR 서버 동시 기동)
npm run dev
```

- Web: http://localhost:5174
- API: http://localhost:8788
- OCR: http://localhost:8789

> 첫 실행 시 manga_ocr 모델(~400MB)을 HuggingFace에서 다운로드하므로 시간이 걸릴 수 있음.

## 사용법

1. URL 입력 후 **이미지 수집** 클릭
2. 개별 페이지 **이 페이지 번역** 또는 **전체 번역** 클릭
3. 이미지 위에 번역 오버레이 표시 (토글 가능)
4. 이미지 아래에 원문 → 번역 리스트 표시

## API 엔드포인트

| 엔드포인트 | 기능 |
|---|---|
| `GET /api/extract-images?url=` | URL에서 만화 이미지 목록 추출 |
| `GET /api/proxy-image?url=` | CORS 우회용 이미지 프록시 |
| `POST /api/translate-page` | 말풍선 검출 + OCR + 번역 (위치 정보 포함) |
| `GET /api/translations?sourceUrl=` | 저장된 번역 불러오기 |
| `POST /api/translations` | 번역 결과 저장 |

## 메모

- fc2 이미지뷰어 URL에 특화된 이미지 수집 로직 포함
- OCR 정확도는 원본 해상도와 말풍선 스타일에 영향받음
- Google Translate는 무료 공개 엔드포인트 기반이라 간헐 실패 가능
- manga_ocr은 MPS(Apple Silicon GPU) 지원
