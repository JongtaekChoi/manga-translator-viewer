import { useState, useEffect } from 'react'

export default function App() {
  const [url, setUrl] = useState('http://galaxyheavyblow.web.fc2.com/fc2-imageviewer/?aid=1&iid=159')
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(false)
  const [translatingAll, setTranslatingAll] = useState(false)
  const [pageBusy, setPageBusy] = useState({})
  const [visibleBubbles, setVisibleBubbles] = useState({})

  // 작품 컨텍스트
  const [workName, setWorkName] = useState('')
  const [context, setContext] = useState('')
  const [generatingCtx, setGeneratingCtx] = useState(false)

  // localStorage에서 작품 컨텍스트 복원
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('mangaCtx') || '{}')
      if (saved.workName) setWorkName(saved.workName)
      if (saved.context) setContext(saved.context)
    } catch {}
  }, [])

  const saveContext = () => {
    if (!workName.trim()) { alert('작품명을 입력하세요'); return }
    localStorage.setItem('mangaCtx', JSON.stringify({ workName, context }))
    alert('저장됨')
  }

  const loadContext = (name) => {
    try {
      const saved = JSON.parse(localStorage.getItem('mangaCtx') || '{}')
      if (saved.workName === name) setContext(saved.context || '')
      else setContext('')
    } catch {}
  }

  const generateContext = async () => {
    if (!workName.trim()) { alert('작품명을 입력하세요'); return }
    setGeneratingCtx(true)
    try {
      const r = await fetch('/api/generate-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workName })
      })
      const data = await r.json()
      if (data.context) setContext(data.context)
      else alert('생성 실패: ' + (data.error || ''))
    } catch (e) {
      alert('생성 실패: ' + e.message)
    } finally {
      setGeneratingCtx(false)
    }
  }

  const toggleBubble = (pageIdx, bubbleIdx) => {
    const key = `${pageIdx}-${bubbleIdx}`
    setVisibleBubbles(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const fetchPages = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/extract-images?url=${encodeURIComponent(url)}`)
      const data = await r.json()
      const newPages = (data.images || []).map((u, i) => ({
        idx: i + 1, imageUrl: u, jp: '', ko: '', bubbles: [], source: ''
      }))
      setPages(newPages)

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
        body: JSON.stringify({ imageUrl: page.imageUrl, idx: page.idx, sourceUrl: url, context })
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

  const exportPage = async (page) => {
    if (!page.bubbles?.length) return
    setPageBusy(prev => ({ ...prev, [`exp-${page.idx}`]: true }))
    try {
      const r = await fetch('/api/export-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: page.imageUrl, bubbles: page.bubbles })
      })
      if (!r.ok) throw new Error('export failed')
      const blob = await r.blob()
      const u = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = u
      a.download = `page-${page.idx}-ko.jpg`
      a.click()
      URL.revokeObjectURL(u)
    } catch (e) {
      alert(`내보내기 실패: ${e.message}`)
    } finally {
      setPageBusy(prev => ({ ...prev, [`exp-${page.idx}`]: false }))
    }
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
        </div>

        <details className="ctx-panel">
          <summary>작품 컨텍스트 설정</summary>
          <div className="ctx-body">
            <div className="ctx-row">
              <input
                value={workName}
                onChange={e => { setWorkName(e.target.value); loadContext(e.target.value) }}
                placeholder="작품명 (예: 원펀맨)"
              />
              <button className="btn-sm btn-purple" onClick={generateContext} disabled={generatingCtx}>
                {generatingCtx ? '생성중...' : 'AI 생성'}
              </button>
              <button className="btn-sm btn-green" onClick={saveContext}>저장</button>
            </div>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="캐릭터 이름, 용어, 말투 등 번역 참고 정보..."
              rows={5}
            />
          </div>
        </details>
      </header>

      <main>
        {pages.map(p => (
          <article key={p.idx} className="card">
            <div className="img-wrap">
              <img src={`/api/proxy-image?url=${encodeURIComponent(p.imageUrl)}`} alt={`p${p.idx}`} loading="lazy" />
              {p.bubbles?.map((b, i) => {
                const key = `${p.idx}-${i}`
                const shown = !!visibleBubbles[key]
                return (
                  <div
                    key={i}
                    className={`bubble-overlay ${shown ? 'active' : ''}`}
                    style={{
                      left: `${b.box.x}%`,
                      top: `${b.box.y}%`,
                      width: `${b.box.w}%`,
                      height: `${b.box.h}%`,
                    }}
                    onClick={() => toggleBubble(p.idx, i)}
                  >
                    {shown && <span className="bubble-text">{b.ko}</span>}
                  </div>
                )
              })}
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
                {p.bubbles?.length > 0 && (
                  <button className="btn-export" onClick={() => exportPage(p)} disabled={pageBusy[`exp-${p.idx}`]}>
                    {pageBusy[`exp-${p.idx}`] ? '생성중...' : '이미지 내보내기'}
                  </button>
                )}
              </div>
              {p.bubbles?.length > 0 && (
                <details className="bubble-details">
                  <summary>번역 {p.bubbles.length}건</summary>
                  <div className="bubble-list">
                    {p.bubbles.map((b, i) => (
                      <p key={i}><span className="jp">{b.text}</span> → <span className="ko">{b.ko}</span></p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </article>
        ))}
      </main>
    </div>
  )
}
