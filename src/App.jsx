import { useState, useEffect, useRef } from 'react'
import { translateImage, generateContext as apiGenerateContext, imageToBase64 } from './lib/openai'
import { getApiKey, saveApiKey, getModel, saveModel, loadContext, saveContext as storeContext } from './lib/storage'
import { exportTranslatedImage } from './lib/export'

const SAMPLE_IMAGES = [
  'samples/sample-1.jpg',
  'samples/sample-2.jpg',
]

export default function App() {
  const [pages, setPages] = useState([])
  const [translatingAll, setTranslatingAll] = useState(false)
  const [pageBusy, setPageBusy] = useState({})
  const [visibleBubbles, setVisibleBubbles] = useState({})

  // 설정
  const [apiKey, setApiKey] = useState(() => getApiKey())
  const [model, setModelState] = useState(() => getModel())
  const [keyInput, setKeyInput] = useState(() => getApiKey())

  // 작품 컨텍스트
  const [workName, setWorkName] = useState('')
  const [context, setContext] = useState('')
  const [generatingCtx, setGeneratingCtx] = useState(false)

  // 드래그앤드롭
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef(null)

  // localStorage에서 작품 컨텍스트 복원
  useEffect(() => {
    const saved = loadContext()
    if (saved.workName) setWorkName(saved.workName)
    if (saved.context) setContext(saved.context)
  }, [])

  const handleSaveKey = () => {
    const trimmed = keyInput.trim()
    saveApiKey(trimmed)
    setApiKey(trimmed)
  }

  const handleModelChange = (e) => {
    const m = e.target.value
    setModelState(m)
    saveModel(m)
  }

  const handleSaveContext = () => {
    if (!workName.trim()) { alert('작품명을 입력하세요'); return }
    storeContext(workName, context)
  }

  const handleGenerateContext = async () => {
    if (!workName.trim()) { alert('작품명을 입력하세요'); return }
    if (!apiKey) { alert('API 키를 먼저 설정하세요'); return }
    setGeneratingCtx(true)
    try {
      const result = await apiGenerateContext(apiKey, workName, model)
      if (result.context) setContext(result.context)
    } catch (e) {
      alert('생성 실패: ' + e.message)
    } finally {
      setGeneratingCtx(false)
    }
  }

  // 이미지 파일 추가
  const addImageFiles = async (files) => {
    const newPages = []
    const startIdx = pages.length
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (!file.type.startsWith('image/')) continue
      const dataUrl = await imageToBase64(file)
      newPages.push({
        idx: startIdx + i + 1,
        imageUrl: dataUrl,
        fileName: file.name,
        jp: '', ko: '', bubbles: [], source: ''
      })
    }
    setPages(prev => [...prev, ...newPages])
  }

  const handleFileSelect = (e) => {
    if (e.target.files?.length) addImageFiles([...e.target.files])
    e.target.value = ''
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files?.length) addImageFiles([...e.dataTransfer.files])
  }

  const handlePaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        files.push(item.getAsFile())
      }
    }
    if (files.length) addImageFiles(files)
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [pages])

  // 데모 이미지 로드
  const loadDemoImages = async () => {
    const newPages = []
    for (let i = 0; i < SAMPLE_IMAGES.length; i++) {
      try {
        const res = await fetch(import.meta.env.BASE_URL + SAMPLE_IMAGES[i])
        const blob = await res.blob()
        const dataUrl = await imageToBase64(blob)
        newPages.push({
          idx: i + 1,
          imageUrl: dataUrl,
          fileName: SAMPLE_IMAGES[i],
          jp: '', ko: '', bubbles: [], source: ''
        })
      } catch {}
    }
    if (newPages.length) setPages(newPages)
    else alert('데모 이미지를 불러올 수 없습니다')
  }

  const toggleBubble = (pageIdx, bubbleIdx) => {
    const key = `${pageIdx}-${bubbleIdx}`
    setVisibleBubbles(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const translatePage = async (page) => {
    if (!apiKey) { alert('API 키를 설정하세요'); return }
    setPageBusy(prev => ({ ...prev, [page.idx]: true }))
    try {
      const prevPages = pages
        .filter(p => p.idx < page.idx && p.bubbles?.length > 0)
        .slice(-3)
        .map(p => `[${p.idx}p] ${p.bubbles.map(b => b.ko).filter(Boolean).join(' / ')}`)
        .join('\n')
      const fullContext = [context, prevPages ? `\n[이전 페이지 대사]\n${prevPages}` : ''].join('')

      const result = await translateImage(apiKey, page.imageUrl, fullContext, model)
      setPages(prev => prev.map(p =>
        p.idx === page.idx
          ? {
              ...p,
              jp: result.bubbles.map(b => b.text).join('\n'),
              ko: result.bubbles.map(b => b.ko).join('\n'),
              bubbles: result.bubbles,
              source: 'auto'
            }
          : p
      ))
    } catch (e) {
      alert(`${page.idx}페이지 번역 실패: ${e.message}`)
    } finally {
      setPageBusy(prev => ({ ...prev, [page.idx]: false }))
    }
  }

  const translateAll = async () => {
    if (!apiKey) { alert('API 키를 설정하세요'); return }
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
      const dataUrl = await exportTranslatedImage(page.imageUrl, page.bubbles)
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `page-${page.idx}-ko.png`
      a.click()
    } catch (e) {
      alert(`내보내기 실패: ${e.message}`)
    } finally {
      setPageBusy(prev => ({ ...prev, [`exp-${page.idx}`]: false }))
    }
  }

  const clearPages = () => {
    setPages([])
    setVisibleBubbles({})
  }

  const untranslatedCount = pages.filter(p => !p.ko).length

  return (
    <div className="wrap">
      <header className="top">
        <h1>만화 번역 뷰어</h1>

        <details className="settings-panel">
          <summary>API 설정 {apiKey ? '(설정됨)' : '(미설정)'}</summary>
          <div className="settings-body">
            <div className="settings-row">
              <input
                type="password"
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder="OpenAI API 키 (sk-...)"
              />
              <button className="btn-sm btn-green" onClick={handleSaveKey}>저장</button>
            </div>
            <div className="settings-row">
              <label>모델</label>
              <select value={model} onChange={handleModelChange}>
                <option value="gpt-4o-mini">gpt-4o-mini (저렴)</option>
                <option value="gpt-4o">gpt-4o (고품질)</option>
              </select>
            </div>
            <p className="settings-note">
              API 키는 브라우저 localStorage에만 저장됩니다. 서버로 전송되지 않습니다.
            </p>
          </div>
        </details>

        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <p>이미지를 드래그하거나 클릭하여 업로드</p>
          <p className="drop-hint">클립보드 붙여넣기(Ctrl+V)도 가능</p>
        </div>

        <div className="controls">
          <button onClick={loadDemoImages} disabled={translatingAll}>
            데모 체험
          </button>
          <button onClick={translateAll} disabled={!pages.length || translatingAll || !untranslatedCount}>
            {translatingAll ? '번역중...' : `전체 번역 (${untranslatedCount})`}
          </button>
          {pages.length > 0 && (
            <button className="btn-danger" onClick={clearPages} disabled={translatingAll}>
              초기화
            </button>
          )}
        </div>

        <details className="ctx-panel">
          <summary>작품 컨텍스트 설정</summary>
          <div className="ctx-body">
            <div className="ctx-row">
              <input
                value={workName}
                onChange={e => setWorkName(e.target.value)}
                placeholder="작품명 (예: 원펀맨)"
              />
              <button className="btn-sm btn-purple" onClick={handleGenerateContext} disabled={generatingCtx}>
                {generatingCtx ? '생성중...' : 'AI 생성'}
              </button>
              <button className="btn-sm btn-green" onClick={handleSaveContext}>저장</button>
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
              <img src={p.imageUrl} alt={`p${p.idx}`} loading="lazy" />
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
                {p.fileName && ` · ${p.fileName}`}
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
