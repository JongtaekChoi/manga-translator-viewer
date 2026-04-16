#!/bin/bash
# 로컬 서버 환경 셋업 (Python venv + 모델 다운로드)
set -e

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  echo "▶ Creating Python venv..."
  python3 -m venv .venv
fi

echo "▶ Installing Python dependencies..."
.venv/bin/pip install --upgrade pip
.venv/bin/pip install \
  manga-ocr \
  opencv-python-headless \
  torch \
  torchvision \
  requests \
  pyclipper \
  shapely \
  einops

CTD_DIR=".venv/comic-text-detector"
if [ ! -d "$CTD_DIR" ]; then
  echo "▶ Cloning comic-text-detector..."
  git clone --depth 1 https://github.com/dmMaze/comic-text-detector.git "$CTD_DIR"
fi

MODEL="$CTD_DIR/data/comictextdetector.pt"
if [ ! -f "$MODEL" ]; then
  echo "▶ Downloading comic-text-detector model (~50MB)..."
  mkdir -p "$CTD_DIR/data"
  curl -L -o "$MODEL" \
    "https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.2.1/comictextdetector.pt"
fi

if [ ! -f .env ]; then
  echo ""
  echo "▶ Create .env with your OpenAI API key:"
  echo "   echo 'OPENAI_API_KEY=sk-...' > .env"
  echo ""
fi

echo "✓ Setup complete."
echo "  Run server: .venv/bin/python scripts/ocr_server.py"
echo "  Or use:     ./scripts/run-server.sh"
