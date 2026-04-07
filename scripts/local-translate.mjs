import axios from 'axios'
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.join(__dirname, '..')
const dataDir = path.join(root, 'data')
const dbPath = path.join(dataDir, 'translations.json')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'moondream'

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

async function downloadImageAsBase64(url) {
  const r = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  return Buffer.from(r.data).toString('base64')
}

async function ollamaVisionTranslate(imageBase64) {
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
    images: [imageBase64],
    stream: false,
    options: { temperature: 0.2 }
  }, { timeout: 120000 })

  const raw = String(data?.response || '').trim()

  // JSON 배열 추출 시도
  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const arr = JSON.parse(match[0])
      if (Array.isArray(arr)) return arr
    } catch {}
  }

  // 실패 시 원본 텍스트 반환
  return [{ jp: '', ko: raw || '[번역 실패]' }]
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
    console.log(`[${i + 1}/${targets.length}] idx=${t.idx} translating...`)

    const base64 = await downloadImageAsBase64(t.imageUrl)
    const result = await ollamaVisionTranslate(base64)

    const jp = result.map(r => r.jp).filter(Boolean).join('\n')
    const ko = result.map(r => r.ko).filter(Boolean).join('\n')

    pages.push({ idx: t.idx, imageUrl: t.imageUrl, jp, ko, source: 'auto' })
    console.log(`[${i + 1}/${targets.length}] idx=${t.idx} done`)
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
