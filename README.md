# Manga Translator Viewer

일본 만화의 말풍선을 AI로 자동 검출하고, 한국어 번역을 오버레이하여 보여주는 도구.

> 크롬 익스텐션으로 만화 사이트에서 바로 번역하거나, 웹앱으로 URL을 입력하여 번역할 수 있습니다.

<!-- 데모 영상/GIF 자리 -->
<!-- ![Demo](docs/demo.gif) -->

---

## 주요 기능

- **말풍선 자동 검출** — comic-text-detector (YOLO 기반) 로 텍스트 영역을 정확하게 검출
- **만화 특화 OCR** — manga_ocr로 검출된 말풍선에서 일본어 텍스트 추출
- **맥락 기반 번역** — OpenAI Vision API로 이미지 장면을 참고한 자연스러운 번역 (Google Translate fallback)
- **오버레이 번역** — 말풍선 위치에 번역을 오버레이, 터치/클릭으로 토글
- **이미지 합성 내보내기** — 원본 텍스트를 인페인팅으로 제거하고 한국어를 렌더링한 이미지 다운로드
- **두 가지 모드** — 크롬 익스텐션 (PC) + 웹앱 (모바일)

---

## 아키텍처

```
┌─ 크롬 익스텐션 ──────────┐     ┌─ 웹앱 (Vite + React) ────┐
│  Content Script          │     │  http://localhost:5174    │
│  - 이미지 감지            │     │  - URL 입력 → 이미지 수집   │
│  - 오버레이 UI            │     │  - 오버레이 + 번역 리스트   │
└──────────┬───────────────┘     └──────────┬───────────────┘
           │                                │
           ▼                                ▼
┌─ Python 서버 (:8789) ────────────────────────────────────┐
│                                                          │
│  comic-text-detector ─→ manga_ocr ─→ OpenAI / Google     │
│  (텍스트 영역 검출)      (일본어 OCR)   (한국어 번역)       │
│                                                          │
│  + 이미지 프록시  + 인페인팅 합성  + CORS 지원             │
└──────────────────────────────────────────────────────────┘
```

---

## 설치

### 1. Python 환경

```bash
# venv 생성 + 의존성 설치
python3 -m venv .venv
.venv/bin/pip install manga-ocr opencv-python-headless torchvision requests torchsummary pyclipper shapely
```

### 2. comic-text-detector 모델

```bash
git clone --depth 1 https://github.com/dmMaze/comic-text-detector.git .venv/comic-text-detector

curl -L -o .venv/comic-text-detector/data/comictextdetector.pt \
  "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.2.1/comictextdetector.pt"
```

### 3. Node 의존성 (웹앱 모드용)

```bash
npm install
```

### 4. OpenAI API 키 (선택)

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

> 키가 없으면 Google Translate로 자동 fallback. OpenAI Vision은 이미지 맥락을 참고하여 훨씬 자연스러운 번역을 제공합니다 (gpt-4o-mini 기준 만화 1화당 약 3원).

---

## 사용법

### 크롬 익스텐션 (PC)

<!-- ![Extension Demo](docs/extension-demo.gif) -->

**서버 시작:**

```bash
source .venv/bin/activate
python scripts/ocr_server.py
```

**익스텐션 설치:**

1. 크롬에서 `chrome://extensions` 접속
2. **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → `extension/` 폴더 선택

**번역 과정:**

1. 만화 사이트 접속
2. 이미지 우상단의 **번역** 버튼 클릭
3. 말풍선 영역이 점선으로 표시됨
4. 말풍선 터치/클릭 → 번역 텍스트 토글
5. **내보내기** 버튼 → 한국어가 합성된 이미지 다운로드

### 웹앱 (모바일 호환)

<!-- ![Web Demo](docs/web-demo.gif) -->

```bash
npm run dev
```

`http://localhost:5174` 접속 → URL 입력 → 이미지 수집 → 번역

---

## API 레퍼런스

Python 서버 (`localhost:8789`)

| 엔드포인트 | 메서드 | 기능 |
|---|---|---|
| `/health` | GET | 서버 상태 + OpenAI 키 유무 |
| `/proxy-image?url=` | GET | CORS 우회 이미지 프록시 |
| `/ocr` | POST | 텍스트 영역 검출 + OCR |
| `/translate` | POST | OCR + 번역 (OpenAI or Google) |
| `/export` | POST | 번역된 이미지 합성 |

---

## 기술 스택

| 구성 | 기술 |
|---|---|
| 텍스트 검출 | [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (YOLOv5) |
| OCR | [manga_ocr](https://github.com/kha-white/manga-ocr) (ViT + TrOCR) |
| 번역 | OpenAI Vision API (gpt-4o-mini) / Google Translate |
| 이미지 합성 | OpenCV inpainting + Pillow text rendering |
| 프론트 (웹) | Vite + React |
| 프론트 (익스텐션) | Chrome Extension Manifest V3 |
| 서버 | Python http.server + Express.js |

---

## 메모

- comic-text-detector와 manga_ocr 모두 **MPS (Apple Silicon GPU)** 지원
- 첫 실행 시 manga_ocr 모델 (~400MB)을 HuggingFace에서 다운로드
- OCR 정확도는 원본 해상도와 말풍선 스타일에 영향받음
- 세로 쓰기 텍스트 렌더링 지원 (이미지 합성 시)
