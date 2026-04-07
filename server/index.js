import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.join(__dirname, '..', 'data')
const DB_PATH = path.join(DATA_DIR, 'translations.json')

const OCR_URL = process.env.OCR_URL || 'http://localhost:8789'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

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

// 이미지 수집
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

// 이미지 프록시
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

// manga_ocr로 말풍선 검출 + OCR → OpenAI 번역
app.post('/api/translate-page', async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || '').trim()
  const idx = Number(req.body?.idx || 0)
  const sourceUrl = String(req.body?.sourceUrl || '').trim()
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })

  try {
    // 1) manga_ocr로 말풍선 검출 + 일본어 텍스트 추출
    const ocrRes = await axios.post(`${OCR_URL}/ocr`, { imageUrl }, { timeout: 120000 })
    const bubbles = ocrRes.data?.bubbles || []

    if (!bubbles.length) {
      const page = { idx, imageUrl, jp: '', ko: '', bubbles: [], source: 'auto' }
      return res.json({ ok: true, page })
    }

    // 2) OpenAI로 전체 말풍선을 한번에 번역 (맥락 유지)
    const context = String(req.body?.context || '').trim()
    const translatedBubbles = await translateBubbles(bubbles, imageUrl, context)

    const jp = bubbles.map(b => b.text).join('\n')
    const ko = translatedBubbles.map(b => b.ko).join('\n')
    const page = { idx, imageUrl, jp, ko, bubbles: translatedBubbles, source: 'auto' }

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

// 번역된 이미지 합성 내보내기
app.post('/api/export-page', async (req, res) => {
  const imageUrl = String(req.body?.imageUrl || '').trim()
  const bubbles = Array.isArray(req.body?.bubbles) ? req.body.bubbles : []
  if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' })

  try {
    const ocrRes = await axios.post(`${OCR_URL}/export`, { imageUrl, bubbles }, {
      timeout: 120000,
      responseType: 'arraybuffer'
    })
    const ct = ocrRes.headers['content-type'] || 'image/jpeg'
    res.setHeader('Content-Type', ct)
    res.setHeader('Content-Disposition', 'attachment; filename="translated.jpg"')
    res.send(Buffer.from(ocrRes.data))
  } catch (e) {
    res.status(500).json({ error: 'export failed', detail: String(e.message || e) })
  }
})

// AI로 작품 컨텍스트 생성
app.post('/api/generate-context', async (req, res) => {
  const workName = String(req.body?.workName || '').trim()
  if (!workName) return res.status(400).json({ error: 'workName is required' })

  try {
    const ocrRes = await axios.post(`${OCR_URL}/generate-context`, { workName }, { timeout: 30000 })
    res.json(ocrRes.data)
  } catch (e) {
    res.status(500).json({ error: 'generate context failed', detail: String(e.response?.data?.error || e.message) })
  }
})

async function translateBubbles(bubbles, imageUrl, context = '') {
  if (!OPENAI_API_KEY) {
    // API 키 없으면 Google Translate fallback
    const result = []
    for (const b of bubbles) {
      let ko = ''
      try {
        const gtRes = await axios.get('https://translate.googleapis.com/translate_a/single', {
          params: { client: 'gtx', sl: 'ja', tl: 'ko', dt: 't', q: b.text },
          timeout: 10000
        })
        ko = Array.isArray(gtRes.data?.[0]) ? gtRes.data[0].map(x => x[0]).join('') : ''
      } catch {}
      result.push({ ...b, ko })
    }
    return result
  }

  // 번호 매긴 원문 목록
  const numbered = bubbles.map((b, i) => `${i + 1}. ${b.text}`).join('\n')

  // 이미지를 base64로 변환 (Vision API용)
  let imageBase64 = null
  if (imageUrl) {
    try {
      const imgRes = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      })
      const ct = imgRes.headers['content-type'] || 'image/jpeg'
      imageBase64 = `data:${ct};base64,${Buffer.from(imgRes.data).toString('base64')}`
    } catch {}
  }

  try {
    const userContent = imageBase64
      ? [
          { type: 'image_url', image_url: { url: imageBase64, detail: 'low' } },
          { type: 'text', text: `이 만화 페이지에서 OCR로 추출한 대사 목록이야. 이미지의 장면과 맥락을 참고해서 번역해줘.\n\n${numbered}` }
        ]
      : numbered

    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: [
              '만화 대사 번역가. 일본어 만화 대사를 한국어로 자연스럽게 번역한다.',
              '- 이미지의 장면, 캐릭터 표정, 상황을 참고하여 맥락에 맞게 번역',
              '- 캐릭터의 말투와 감정을 살려서 번역',
              '- 의역보다는 원문의 뉘앙스를 유지하되 한국어로 자연스럽게',
              '- 효과음이나 의미없는 텍스트는 그대로 음역',
              '- 출력: 번호와 번역만. 설명 없이.',
              '- 형식: 각 줄에 "번호. 번역"',
              ...(context ? [`\n[작품 정보]\n${context}`] : [])
            ].join('\n')
          },
          { role: 'user', content: userContent }
        ]
      },
      {
        timeout: 60000,
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' }
      }
    )

    const raw = data?.choices?.[0]?.message?.content || ''
    // "1. 번역\n2. 번역" 파싱
    const koMap = new Map()
    for (const line of raw.split('\n')) {
      const m = line.match(/^(\d+)\.\s*(.+)/)
      if (m) koMap.set(Number(m[1]), m[2].trim())
    }

    return bubbles.map((b, i) => ({ ...b, ko: koMap.get(i + 1) || '' }))
  } catch (e) {
    console.error('OpenAI translate error:', e.response?.data?.error?.message || e.message)
    // 실패 시 Google Translate fallback
    const result = []
    for (const b of bubbles) {
      let ko = ''
      try {
        const gtRes = await axios.get('https://translate.googleapis.com/translate_a/single', {
          params: { client: 'gtx', sl: 'ja', tl: 'ko', dt: 't', q: b.text },
          timeout: 10000
        })
        ko = Array.isArray(gtRes.data?.[0]) ? gtRes.data[0].map(x => x[0]).join('') : ''
      } catch {}
      result.push({ ...b, ko })
    }
    return result
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running on :${PORT}`)
  console.log(`  OCR server: ${OCR_URL}`)
})
