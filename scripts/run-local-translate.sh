#!/usr/bin/env bash
set -euo pipefail

export PATH="/Users/jtchoi/.nvm/versions/node/v23.1.0/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export OCR_URL="${OCR_URL:-http://localhost:8789}"

node scripts/local-translate.mjs "$1" "${2:-}"
