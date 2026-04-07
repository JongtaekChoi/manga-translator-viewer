#!/usr/bin/env bash
set -euo pipefail

export PATH="/Users/jtchoi/.nvm/versions/node/v23.1.0/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-moondream}"

node scripts/local-translate.mjs "$1" "${2:-}"
