# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manga Translator Viewer: fully client-side tool that uses OpenAI Vision API to detect speech bubbles in Japanese manga, perform OCR, and overlay Korean translations. Works as both a web app and a Chrome extension. No server required — deployable on GitHub Pages.

## Commands

```bash
npm run dev        # Vite dev server on :5174
npm run build      # Production build to dist/
npm run preview    # Preview production build
npm run deploy     # Build + deploy to GitHub Pages via gh-pages
```

## Architecture

Single-page React app that calls the OpenAI Vision API directly from the browser.

**Web app** (`src/App.jsx`) — User uploads manga images (file upload, drag-and-drop, paste) or loads demo samples. Each image is sent to OpenAI Vision API which returns bubble positions + OCR + Korean translation in one call.

**Chrome extension** (`extension/`) — Manifest V3 content script adds translate buttons to manga images on any page. Background service worker calls OpenAI API directly (extension has no CORS restrictions).

### Key modules (`src/lib/`)

- `openai.js` — `translateImage()` sends one Vision API call that detects bubbles, reads Japanese text, and translates to Korean. Returns `{ bubbles: [{text, ko, box:{x,y,w,h}}] }` with percentage-based coordinates. Also `generateContext()` for work metadata.
- `storage.js` — localStorage wrapper for API key, model selection, work context, translations.
- `export.js` — Canvas-based image export: white-fills bubble areas and renders Korean text.

### Translation pipeline

Image (base64) → OpenAI Vision API (single call) → JSON with bubble positions (%) + Japanese text + Korean translation → overlay rendering

### Design details

- Bubble positions are percentage-based (`box.x/y/w/h` as % of image dimensions)
- Translation context includes previous page translations (up to 3 pages) for narrative continuity
- User provides their own OpenAI API key (stored in localStorage / chrome.storage.local)
- `response_format: { type: 'json_object' }` ensures parseable structured output
- `detail: 'high'` for accurate bounding box detection
- Demo sample images in `public/samples/`
- GitHub Pages deployment with `base: '/manga-translator-viewer/'` in vite.config.js
