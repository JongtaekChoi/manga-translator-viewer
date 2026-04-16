#!/bin/bash
cd "$(dirname "$0")/.."
exec .venv/bin/python scripts/ocr_server.py "$@"
