# Manga Translator Viewer

일본 만화를 자동으로 한국어 번역해주는 크롬 익스텐션 + 로컬 Python 서버.

말풍선을 검출하고 OCR → 번역 → 인페인팅 + 한국어 합성까지 서버에서 처리하고, 확장은 이미지를 번역본으로 교체해 보여줍니다.

---

## 주요 기능

- **말풍선 자동 검출** — comic-text-detector(YOLO 기반)로 텍스트 영역 검출
- **Vision OCR + 번역** — 각 풍선 crop을 OpenAI Vision에 multi-image 1회 호출로 OCR + 번역을 동시에 수행 (효과음/스타일리쉬 폰트도 강건)
- **CTD 실패 시 fallback** — 임계값 자동 완화 → 그래도 실패하면 전체 페이지를 GPT Vision에 맡김
- **인페인팅 + 합성** — 원문 텍스트를 OpenCV inpainting으로 지우고 한국어를 직접 그려서 반환
- **사이트별 활성화 토글** — 팝업에서 "이 사이트에서 활성화" 체크 → 해당 호스트에서만 버튼 표시
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
│  comic-text-detector — 말풍선 bbox 검출                   │
│              ↓                                          │
│  crops → OpenAI Vision (multi-image 1회 호출)            │
│   → 각 crop OCR + 번역을 LLM이 한 번에 처리               │
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
- 의존성 설치 (torch, torchvision, opencv, shapely 등)
- comic-text-detector 리포 clone (`.venv/comic-text-detector/`)
- 모델 파일 다운로드 (`comictextdetector.pt`, ~50MB)

### 2. OpenAI API 키 (필수)

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

`.env`에 선택 사항으로 기본 모델도 지정 가능 (팝업에서 덮어쓸 수 있음):
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

OpenAI Vision이 OCR + 번역을 모두 담당하므로 키는 반드시 설정해야 합니다.

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
7. 만화 사이트로 이동 후 팝업에서 **이 사이트에서 활성화** 체크
8. (선택) 작품명 + 컨텍스트 저장

---

## 사용법

### 사이트 활성화

버튼은 기본적으로 숨겨져 있어서 일반 웹 서핑에는 방해되지 않습니다. 만화 사이트에서 쓰려면:

1. 만화 사이트로 이동
2. 확장 아이콘 클릭 → 팝업 열기
3. **이 사이트에서 활성화** 체크 → 즉시 이미지에 버튼 표시
4. 해당 호스트는 저장되어 다음 방문 시 자동 활성화

### 개별 이미지 번역

1. 이미지 위의 **번역** 버튼 클릭
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
| `/translate-render` | POST | 검출 + 번역 + 렌더링을 한 번에 (확장이 사용) |
| `/generate-context` | POST | 작품명으로 컨텍스트 초안 생성 |

`/translate-render` 요청 body:
```json
{
  "imageUrl": "https://.../page.jpg",
  "context": "작품 컨텍스트...",
  "model": "gpt-4o-mini",
  "referer": "https://manga-site.com/..."
}
```

`referer`는 핫링크 방지하는 만화 사이트 대응용 (확장이 자동으로 페이지 URL 전달).

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
| OCR + 번역 | OpenAI Vision (gpt-4o-mini / gpt-4o / gpt-4.1) — multi-image 단일 호출 |
| 이미지 합성 | OpenCV inpainting + Pillow 한글 렌더링 |
| 서버 | Python `http.server` (의존성 최소) |
| 익스텐션 | Chrome Manifest V3 |

---

## 성능 메모

- MPS 자동 감지: Apple Silicon에서 CTD가 GPU 가속으로 동작
- Vision API는 multi-image 1회 호출로 페이지 내 모든 풍선 일괄 처리
- 서버 로그에 단계별 timing 출력 (`[timing] ctd=... translate=... render=... total=...`)
- 번역본은 클라이언트에서 blob URL로 변환해 캐싱 → 토글/재사용 시 재디코딩 없음
- 일반 페이지 기준 처리 시간: 검출 ~1s + Vision 호출 3~8s + 렌더 <1s

## 디버깅

CTD가 풍선을 못 찾는 경우 (`detections=0` 로그):

1. **임계값 완화** — `.env`에 `CTD_CONF_THRESH=0.15` 추가 후 서버 재시작
2. **자동 재시도** — 0.25로 0개 검출되면 0.1로 한 번 더 시도 (내장)
3. **Full-page Vision fallback** — 위 둘 다 실패 시 전체 페이지를 GPT Vision에 통째로 맡김 (내장, bbox 정확도 떨어짐)

이미지 다운로드 문제 확인:
- 서버가 마지막 다운로드를 `/tmp/mtl_last_download.jpg`에 저장 → `open /tmp/mtl_last_download.jpg`로 실제 받은 이미지 확인
- 다운로드 실패 / placeholder인 경우 Referer 체크하는 사이트 — 확장이 자동 전달하지만 일부 사이트는 추가 검증 있을 수 있음

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
