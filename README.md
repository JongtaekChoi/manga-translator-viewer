# Manga Translator Viewer

일본 만화를 자동으로 한국어 번역해주는 크롬 익스텐션 + 로컬 Python 서버.

말풍선을 검출하고 OCR → 번역 → 인페인팅 + 한국어 합성까지 서버에서 처리하고, 확장은 이미지를 번역본으로 교체해 보여줍니다.

---

## 주요 기능

- **말풍선 자동 검출** — comic-text-detector(YOLO 기반)로 텍스트 영역 검출
- **만화 특화 OCR** — manga_ocr로 일본어 텍스트 추출 (병렬 실행)
- **맥락 기반 번역** — OpenAI Vision으로 이미지 장면을 참고한 자연스러운 번역 (OpenAI 키 없으면 Google Translate fallback)
- **인페인팅 + 합성** — 원문 텍스트를 OpenCV inpainting으로 지우고 한국어를 직접 그려서 반환
- **작품 컨텍스트** — 캐릭터명/용어/말투를 저장해두면 모든 페이지 번역에 반영
- **이미지 단위 / 페이지 전체 번역** — 개별 이미지에 "번역" 버튼 or 팝업에서 현재 탭 전체 번역

---



https://github.com/user-attachments/assets/65a1a1b7-3927-412b-a482-b0f5a9c71300



## 아키텍처

```
┌─ 크롬 익스텐션 ──────────────┐
│  content.js                  │
│   - 이미지에 "번역" 버튼 삽입  │
│   - 서버 응답(JPEG)로 img 교체│
│  background.js               │
│   - 서버 HTTP 중계             │
│  popup                       │
│   - 서버 URL / 모델 / 컨텍스트 │
└──────────┬───────────────────┘
           │ POST /translate-render
           ▼
┌─ Python 서버 (localhost:8789) ──────────────────────────┐
│                                                         │
│  comic-text-detector → manga_ocr (4-way parallel)       │
│              ↓                                          │
│         OpenAI / Google Translate                       │
│              ↓                                          │
│      OpenCV inpainting + Pillow 한글 렌더               │
│                                                         │
│      결과: 번역된 JPEG (base64 data URL)                 │
└──────────────────────────────────────────────────────────┘
```

---

## 설치

### 1. 서버 셋업 (자동)

```bash
./scripts/setup-server.sh
```

위 스크립트가 수행:
- Python venv 생성 (`.venv/`)
- 의존성 설치 (manga-ocr, torch, torchvision, opencv, shapely 등)
- comic-text-detector 리포 clone (`.venv/comic-text-detector/`)
- 모델 파일 다운로드 (`comictextdetector.pt`, ~50MB)

첫 실행 시 manga_ocr 모델(~400MB)은 HuggingFace에서 자동 다운로드됩니다.

### 2. OpenAI API 키 (권장)

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

`.env`에 선택 사항으로 기본 모델도 지정 가능 (팝업에서 덮어쓸 수 있음):
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

키가 없으면 Google Translate로 fallback됩니다.

### 3. 서버 시작

```bash
./scripts/run-server.sh
# 또는: .venv/bin/python scripts/ocr_server.py
```

기본 포트 `8789`. 다른 포트 쓰려면 `./scripts/run-server.sh 8790`.

**외부 기기(폰/노트북)에서 접근 허용:** `scripts/ocr_server.py` 맨 아래의 `HTTPServer(("127.0.0.1", port), Handler)`를 `("0.0.0.0", port)`로 변경.

### 4. 크롬 익스텐션 설치

1. 크롬에서 `chrome://extensions` 접속
2. 우상단 **개발자 모드** ON
3. **압축해제된 확장 프로그램을 로드합니다** → `extension/` 폴더 선택
4. 툴바의 퍼즐 아이콘에서 확장을 **📌 고정**
5. 확장 팝업 열고 서버 URL 입력 (기본 `http://localhost:8789`)
6. 모델 선택 (기본 `gpt-4o-mini`)
7. (선택) 작품명 + 컨텍스트 저장

---

## 사용법

### 개별 이미지 번역

1. 만화 사이트에서 이미지 위의 **번역** 버튼 클릭
2. 서버가 자동으로 검출 + OCR + 번역 + 합성 (페이지당 5~15초)
3. 이미지가 번역본으로 교체됨
4. **원본** 버튼: 원본/번역본 토글
5. **저장** 버튼: 번역본 PNG 다운로드
6. **다시 번역**: 컨텍스트 수정 후 재번역

### 페이지 전체 번역

확장 팝업의 **현재 페이지 전체 번역** 버튼 → 탭 안의 모든 "번역" 버튼이 순차 클릭됩니다. 서버가 single-threaded라 이미지 수 × 10초 정도 걸림.

### 컨텍스트 활용

팝업의 **작품명** 입력란 클릭 시 저장된 목록이 드롭다운으로 나옴. 예:

```
작품명: 원펀맨

컨텍스트:
[캐릭터명]
- サイタマ → 사이타마
- ジェノス → 제노스
- バゲマント → 대머리망토 군

[말투]
- 사이타마: 무심한 반말
- 제노스: 정중한 존댓말
```

**AI 생성** 버튼을 누르면 작품명만으로 초기 컨텍스트를 자동 생성해줍니다.

---

## 외부 접근 (선택)

맥미니 등 집 서버에 올려두고 어디서나 쓰려면:

- **Tailscale** (권장): VPN처럼 동작. 기기마다 앱 설치만 하면 `http://mac-mini:8789` 같은 내부 hostname으로 접근 가능. 무료.
- **Cloudflare Tunnel**: 공개 HTTPS URL 부여. 무료, 고정 URL.
- **ngrok**: 가장 간단하지만 무료 플랜은 URL이 매번 바뀜.

---

## API 레퍼런스

Python 서버 (`localhost:8789`)

| 엔드포인트 | 메서드 | 기능 |
|---|---|---|
| `/health` | GET | 서버 상태 + OpenAI 키 유무 |
| `/proxy-image?url=` | GET | CORS 우회 이미지 프록시 |
| `/ocr` | POST | 텍스트 영역 검출 + OCR |
| `/translate` | POST | OCR + 번역 (bubbles 배열 반환) |
| `/translate-render` | POST | 검출 + 번역 + 렌더링을 한 번에 (확장이 사용) |
| `/export` | POST | bubbles 배열 받아 번역본 이미지 합성 |
| `/generate-context` | POST | 작품명으로 컨텍스트 초안 생성 |

`/translate-render` 요청 body:
```json
{
  "imageUrl": "https://.../page.jpg",
  "context": "작품 컨텍스트...",
  "model": "gpt-4o-mini"
}
```

응답:
```json
{
  "bubbles": [{"text": "...", "ko": "...", "box": {...}}, ...],
  "rendered": "data:image/jpeg;base64,..."
}
```

---

## 기술 스택

| 구성 | 기술 |
|---|---|
| 텍스트 검출 | [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (YOLOv5) |
| OCR | [manga_ocr](https://github.com/kha-white/manga-ocr) (ViT + TrOCR) |
| 번역 | OpenAI Chat Completions (gpt-4o-mini / gpt-4o / gpt-4.1) / Google Translate |
| 이미지 합성 | OpenCV inpainting + Pillow 한글 렌더링 |
| 서버 | Python `http.server` (의존성 최소) |
| 익스텐션 | Chrome Manifest V3 |

---

## 성능 메모

- MPS 자동 감지: Apple Silicon에서 CTD/manga_ocr이 GPU 가속으로 동작
- OCR은 ThreadPoolExecutor(4)로 병렬 실행 → 풍선 많은 페이지에서 체감 속도 큰 차이
- 서버 로그에 단계별 timing 출력 (`[timing] ctd=... ocr=... translate=... render=... total=...`)
- 번역본은 클라이언트에서 blob URL로 변환해 캐싱 → 토글/재사용 시 재디코딩 없음
- 일반 페이지 기준 처리 시간: 검출 ~1s + OCR 2~6s + 번역 3~6s + 렌더 <1s

---

## 파일 구조

```
manga-translator-viewer/
├── extension/              # 크롬 확장 (Manifest V3)
│   ├── manifest.json
│   ├── background.js       # 서버 HTTP 중계
│   ├── content.js          # 이미지 감지 + 번역 버튼
│   ├── content.css
│   ├── popup.html/js       # 서버/모델/컨텍스트 설정
│   └── icons/
├── scripts/
│   ├── ocr_server.py       # Python 서버 (검출+OCR+번역+합성)
│   ├── setup-server.sh     # 자동 셋업
│   └── run-server.sh       # 실행 헬퍼
├── src/                    # (레거시) 웹앱 — 현재 버전에서는 미사용
├── .env                    # OPENAI_API_KEY, OPENAI_MODEL
└── .venv/                  # Python venv + comic-text-detector
```
