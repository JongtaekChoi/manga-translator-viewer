import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'translations.json')
const execFileAsync = promisify(execFile)

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'moondream'

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

const PORT = 8788

async function readDb() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    const raw = await fs.readFile(DB_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { items: {} }
  }
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8')
}

function normalizeUrl(src, pageUrl) {
  try {
    return new URL(src, pageUrl).toString()
  } catch {
    return null
  }
}

function sortByTrailingNumber(urls) {
  return urls.sort((a, b) => {
    const na = Number((a.match(/\/(\d+)\.(jpg|jpeg|png|webp)(\?|$)/i) || [])[1] || 0)
    const nb = Number((b.match(/\/(\d+)\.(jpg|jpeg|png|webp)(\?|$)/i) || [])[1] || 0)
    return na - nb
  })
}

app.get('/api/extract-images', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).json({ error: 'url is required' })

  try {
    const m = String(url).match(/aid=(\d+).*iid=(\d+)/)
    if (m) {
      const [, aid, iid] = m
      const maxProbe = 80
      const batchSize = 10
      const hit = new Map()

      for (let start = 1; start <= maxProbe; start += batchSize) {
        const batch = Array.from({ length: batchSize }, (_, k) => start + k).filter(n => n <= maxProbe)
        await Promise.all(batch.map(async (n) => {
          const img = `http://galaxyheavyblow.web.fc2.com/fc2-imageviewer/${aid}/${iid}/${n}.jpg`
          try {
            const r = await axios.head(img, {
              timeout: 1800,
              validateStatus: () => true,
              headers: { 'User-Agent': 'Mozilla/5.0' }
            })
            const ct = r.headers['content-type'] || ''
            const len = Number(r.headers['content-length'] || 0)
            if (r.status === 200 && ct.includes('image') && len > 1000) hit.set(n, img)
          } catch {}
        }))
      }

      const images = []
      for (let n = 1; n <= maxProbe; n++) {
        if (!hit.has(n)) break
        images.push(hit.get(n))
      }

      if (images.length) return res.json({ count: images.length, images, mode: 'fc2-fast' })
    }

    const { data: html } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })

    const $ = cheerio.load(html)
    const found = new Set()

    $('img').each((_, el) => {
      const src = $(el).attr('src')
      if (!src) return
      const abs = normalizeUrl(src, url)
      if (!abs) return
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(abs)) found.add(abs)
    })

    const candidates = sortByTrailingNumber([...found])
    res.json({ count: candidates.length, images: candidates.slice(0, 200), mode: 'generic' })
  } catch (e) {
    res.status(500).json({ error: 'extract failed', detail: String(e.message || e) })
  }
})

app.get('/api/proxy-image', async (req, res) => {
  const { url } = req.query
  if (!url) return res.status(400).send('url required')
  try {
    const r = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const ct = r.headers['content-type'] || 'image/jpeg'
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.send(Buffer.from(r.data))
  } catch {
    res.status(500).send('proxy failed')
  }
})

// ollama 비전 모델로 단일 페이지 번역
app.post('/api/translate-page', async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || '').trim()
  const idx = Number(req.body?.idx || 0)
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })

  try {
    // 이미지 다운로드 → base64
    const imgRes = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const base64 = Buffer.from(imgRes.data).toString('base64')

    const prompt = [
      'This is a Japanese manga page.',
      'Extract all dialogue text (speech bubbles, narration) in Japanese, then translate each line to Korean.',
      'Ignore sound effects and background decorative text.',
      'Output ONLY valid JSON array: [{"jp":"Japanese text","ko":"Korean translation"}]',
      'If no dialogue is found, output: []'
    ].join(' ')

    const { data } = await axios.post(`${OLLAMA_URL}/api/generate`, {
      model: OLLAMA_MODEL,
      prompt,
      images: [base64],
      stream: false,
      options: { temperature: 0.2 }
    }, { timeout: 120000 })

    const raw = String(data?.response || '').trim()

    let result = [{ jp: '', ko: raw || '[번역 실패]' }]
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try {
        const arr = JSON.parse(match[0])
        if (Array.isArray(arr)) result = arr
      } catch {}
    }

    const jp = result.map(r => r.jp).filter(Boolean).join('\n')
    const ko = result.map(r => r.ko).filter(Boolean).join('\n')

    const page = { idx, imageUrl, jp, ko, source: 'auto' }

    // DB에 자동 저장
    if (sourceUrl && idx) {
      const db = await readDb()
      const prev = db.items[sourceUrl]?.pages || []
      const map = new Map(prev.map(p => [Number(p.idx), p]))
      map.set(idx, page)
      const mergedPages = [...map.values()].sort((a, b) => Number(a.idx) - Number(b.idx))
      db.items[sourceUrl] = { sourceUrl, updatedAt: new Date().toISOString(), pages: mergedPages }
      await writeDb(db)
    }

    res.json({ ok: true, page })
  } catch (e) {
    res.status(500).json({ error: 'translate failed', detail: String(e.message || e) })
  }
})

// 번역 결과 저장/불러오기
app.get('/api/translations', async (req, res) => {
  const sourceUrl = String(req.query.sourceUrl || '').trim()
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl is required' })
  const db = await readDb()
  res.json({ item: db.items[sourceUrl] || null })
})

app.post('/api/translations', async (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  const pages = Array.isArray(req.body?.pages) ? req.body.pages : null
  if (!sourceUrl || !pages) return res.status(400).json({ error: 'sourceUrl and pages are required' })

  const normalizedPages = pages.map((p, i) => ({
    idx: Number(p.idx || i + 1),
    imageUrl: String(p.imageUrl || ''),
    jp: String(p.jp || ''),
    ko: String(p.ko || ''),
    source: String(p.source || 'auto')
  }))

  const db = await readDb()
  db.items[sourceUrl] = {
    sourceUrl,
    updatedAt: new Date().toISOString(),
    pages: normalizedPages
  }
  await writeDb(db)

  res.json({ ok: true, count: normalizedPages.length })
})

// 쉘스크립트로 전체/단일 페이지 번역 실행
app.post('/api/run-local-translate', async (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl is required' })

  try {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'run-local-translate.sh')
    const { stdout, stderr } = await execFileAsync(scriptPath, [sourceUrl], {
      timeout: 1000 * 60 * 20,
      maxBuffer: 1024 * 1024 * 4
    })
    res.json({ ok: true, stdout, stderr })
  } catch (e) {
    res.status(500).json({
      error: 'local translate failed',
      detail: String(e.stderr || e.message || e)
    })
  }
})

app.post('/api/run-local-translate-page', async (req, res) => {
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  const idx = Number(req.body?.idx || 0)
  if (!sourceUrl || !idx) return res.status(400).json({ error: 'sourceUrl and idx are required' })

  try {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'run-local-translate.sh')
    const { stdout, stderr } = await execFileAsync(scriptPath, [sourceUrl, String(idx)], {
      timeout: 1000 * 60 * 5,
      maxBuffer: 1024 * 1024 * 2
    })

    const db = await readDb()
    const page = (db.items[sourceUrl]?.pages || []).find(p => Number(p.idx) === idx) || null
    res.json({ ok: true, stdout, stderr, page })
  } catch (e) {
    res.status(500).json({
      error: 'local translate page failed',
      detail: String(e.stderr || e.message || e)
    })
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on :${PORT}`)
})
