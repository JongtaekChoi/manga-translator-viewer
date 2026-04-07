import axios from 'axios'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'data')
const dbPath = path.join(dataDir, 'translations.json')

const OCR_URL = process.env.OCR_URL || 'http://localhost:8789'

const sourceUrl = process.argv[2]
const singleIdx = Number(process.argv[3] || 0)
if (!sourceUrl) {
  console.error('usage: node scripts/local-translate.mjs <sourceUrl> [singleIdx]')
  process.exit(1)
}

function extractFc2Images(url) {
  const m = String(url).match(/aid=(\d+).*iid=(\d+)/)
  if (!m) return []
  const [, aid, iid] = m
  return Array.from({ length: 80 }, (_, i) => `http://galaxyheavyblow.web.fc2.com/fc2-imageviewer/${aid}/${iid}/${i + 1}.jpg`)
}

async function headOk(url) {
  try {
    const r = await axios.head(url, {
      timeout: 1800,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    const ct = r.headers['content-type'] || ''
    const len = Number(r.headers['content-length'] || 0)
    return r.status === 200 && ct.includes('image') && len > 1000
  } catch {
    return false
  }
}

async function collectImages(url) {
  const candidates = extractFc2Images(url)
  if (!candidates.length) return []
  const images = []
  for (const img of candidates) {
    if (!(await headOk(img))) break
    images.push(img)
  }
  return images
}

async function ocrImage(imageUrl) {
  const { data } = await axios.post(`${OCR_URL}/ocr`, { imageUrl }, { timeout: 60000 })
  return String(data?.text || '').trim()
}

async function translateText(jp) {
  if (!jp) return '[텍스트 없음]'
  try {
    const { data } = await axios.get('https://translate.googleapis.com/translate_a/single', {
      params: { client: 'gtx', sl: 'ja', tl: 'ko', dt: 't', q: jp },
      timeout: 10000
    })
    return Array.isArray(data?.[0]) ? data[0].map(x => x[0]).join('') : '[번역 실패]'
  } catch {
    return '[번역 실패]'
  }
}

async function readDb() {
  try {
    const raw = await fs.readFile(dbPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { items: {} }
  }
}

async function main() {
  await fs.mkdir(dataDir, { recursive: true })
  const images = await collectImages(sourceUrl)
  if (!images.length) throw new Error('이미지 수집 실패')

  const targets = singleIdx > 0
    ? [{ idx: singleIdx, imageUrl: images[singleIdx - 1] }].filter(x => !!x.imageUrl)
    : images.map((imageUrl, i) => ({ idx: i + 1, imageUrl }))

  if (!targets.length) throw new Error('대상 페이지를 찾을 수 없음')

  const pages = []

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    console.log(`[${i + 1}/${targets.length}] idx=${t.idx} OCR...`)

    const jp = await ocrImage(t.imageUrl)
    console.log(`[${i + 1}/${targets.length}] idx=${t.idx} jp: ${jp.slice(0, 60)}`)

    const ko = await translateText(jp)
    console.log(`[${i + 1}/${targets.length}] idx=${t.idx} ko: ${ko.slice(0, 60)}`)

    pages.push({ idx: t.idx, imageUrl: t.imageUrl, jp, ko, source: 'auto' })
  }

  const db = await readDb()
  const prev = db.items[sourceUrl]?.pages || []
  const map = new Map(prev.map(p => [Number(p.idx), p]))
  for (const p of pages) {
    map.set(Number(p.idx), p)
  }

  const mergedPages = [...map.values()].sort((a, b) => Number(a.idx) - Number(b.idx))

  db.items[sourceUrl] = {
    sourceUrl,
    updatedAt: new Date().toISOString(),
    pages: mergedPages
  }
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2), 'utf-8')

  console.log(`saved: ${pages.length} updated, total ${mergedPages.length}`)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
