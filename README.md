# manga-translator-viewer

URL 입력 → 이미지 수집 → OCR(일본어) → 한국어 번역을 페이지별로 보여주는 모바일 우선 뷰어.

## 실행

```bash
cd /Users/jtchoi/Projects/manga-translator-viewer
npm install
# LLM 비전 번역 사용 시
export OPENAI_API_KEY=your_key_here
# (선택) export OPENAI_VISION_MODEL=gpt-4o-mini
npm run dev
```

- Web: http://localhost:5174
- API: http://localhost:8788

Tailscale 같은 네트워크에서 보려면, 개발 머신 IP로 `5174` 포트 접속.

## 현재 구현
- 이미지 목록 수집(`/api/extract-images`)
- 이미지 프록시(`/api/proxy-image`)
- OCR + 번역 버튼(페이지 순차 처리)
- 모바일 최적화 카드 UI

## 메모
- OCR 정확도는 원본 해상도/말풍선 크기에 영향받음
- 번역 API는 공개 엔드포인트 기반이라 간헐 실패 가능
