import { useState } from 'react'

export default function App() {
  const [url, setUrl] = useState('http://galaxyheavyblow.web.fc2.com/fc2-imageviewer/?aid=1&iid=159')
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(false)
  const [translatingAll, setTranslatingAll] = useState(false)
  const [pageBusy, setPageBusy] = useState({})
  const [showOverlay, setShowOverlay] = useState(true)

  const fetchPages = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/extract-images?url=${encodeURIComponent(url)}`)
      const data = await r.json()
      const newPages = (data.images || []).map((u, i) => ({
        idx: i + 1, imageUrl: u, jp: '', ko: '', bubbles: [], source: ''
      }))
      setPages(newPages)

      // 저장된 번역이 있으면 자동 로드
      try {
        const tr = await fetch(`/api/translations?sourceUrl=${encodeURIComponent(url)}`)
        const trData = await tr.json()
        if (trData?.item?.pages?.length) {
          const map = new Map(trData.item.pages.map(p => [Number(p.idx), p]))
          setPages(prev => prev.map(p => ({
            ...p,
            jp: map.get(p.idx)?.jp || p.jp,
            ko: map.get(p.idx)?.ko || p.ko,
            bubbles: map.get(p.idx)?.bubbles || p.bubbles,
            source: map.get(p.idx)?.source || p.source
          })))
        }
      } catch {}
    } catch {
      alert('이미지 수집 실패')
    } finally {
      setLoading(false)
    }
  }

  const translatePage = async (page) => {
    setPageBusy(prev => ({ ...prev, [page.idx]: true }))
    try {
      const r = await fetch('/api/translate-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: page.imageUrl, idx: page.idx, sourceUrl: url })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data?.error || 'failed')
      setPages(prev => prev.map(p =>
        p.idx === page.idx
          ? { ...p, jp: data.page.jp, ko: data.page.ko, bubbles: data.page.bubbles || [], source: 'auto' }
          : p
      ))
    } catch (e) {
      alert(`${page.idx}페이지 번역 실패: ${e.message}`)
    } finally {
      setPageBusy(prev => ({ ...prev, [page.idx]: false }))
    }
  }

  const translateAll = async () => {
    setTranslatingAll(true)
    const untranslated = pages.filter(p => !p.ko)
    for (const page of untranslated) {
      await translatePage(page)
    }
    setTranslatingAll(false)
  }

  const untranslatedCount = pages.filter(p => !p.ko).length

  return (
    <div className="wrap">
      <header className="top">
        <h1>만화 번역 뷰어</h1>
        <div className="controls">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="이미지 뷰어 URL" />
          <button onClick={fetchPages} disabled={loading || translatingAll}>
            {loading ? '수집중...' : '이미지 수집'}
          </button>
          <button onClick={translateAll} disabled={!pages.length || translatingAll || !untranslatedCount}>
            {translatingAll ? '번역중...' : `전체 번역 (${untranslatedCount})`}
          </button>
          <label className="toggle">
            <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} />
            오버레이
          </label>
        </div>
      </header>

      <main>
        {pages.map(p => (
          <article key={p.idx} className="card">
            <div className="img-wrap">
              <img src={`/api/proxy-image?url=${encodeURIComponent(p.imageUrl)}`} alt={`p${p.idx}`} loading="lazy" />
              {showOverlay && p.bubbles?.map((b, i) => (
                <div
                  key={i}
                  className="bubble-overlay"
                  style={{
                    left: `${b.box.x}%`,
                    top: `${b.box.y}%`,
                    width: `${b.box.w}%`,
                    height: `${b.box.h}%`,
                  }}
                >
                  <span className="bubble-text">{b.ko}</span>
                </div>
              ))}
            </div>
            <div className="meta">
              <h3>
                {p.idx}페이지
                {p.bubbles?.length > 0 && ` · ${p.bubbles.length}칸`}
                {p.source === 'auto' && !p.bubbles?.length && p.ko === '' && ' · 대사 없음'}
              </h3>
              <div className="row-actions">
                <button onClick={() => translatePage(p)} disabled={pageBusy[p.idx] || translatingAll}>
                  {pageBusy[p.idx] ? '번역중...' : '이 페이지 번역'}
                </button>
              </div>
              {p.bubbles?.length > 0 && (
                <div className="bubble-list">
                  {p.bubbles.map((b, i) => (
                    <p key={i}><span className="jp">{b.text}</span> → <span className="ko">{b.ko}</span></p>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </main>
    </div>
  )
}
