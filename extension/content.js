// 로컬 서버를 호출해 말풍선 자동 검출 + 번역 + 렌더링된 이미지로 교체

const MIN_IMG_SIZE = 200
const WRAP_CLASS = 'mtl-img-wrap'

const wrapState = new WeakMap()

function addTranslateButtons() {
  const images = document.querySelectorAll('img')

  images.forEach(img => {
    if (img.closest(`.${WRAP_CLASS}`)) return
    if (img.naturalWidth < MIN_IMG_SIZE || img.naturalHeight < MIN_IMG_SIZE) return

    const wrap = document.createElement('div')
    wrap.className = WRAP_CLASS
    img.parentNode.insertBefore(wrap, img)

    const toolbar = document.createElement('div')
    toolbar.className = 'mtl-toolbar'
    wrap.appendChild(toolbar)
    wrap.appendChild(img)

    const btn = document.createElement('button')
    btn.className = 'mtl-translate-btn'
    btn.textContent = '번역'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleTranslate(img, wrap, btn)
    })
    toolbar.appendChild(btn)
  })
}

function getToolbar(wrap) {
  return wrap.querySelector('.mtl-toolbar')
}

async function dataUrlToBlobUrl(dataUrl) {
  const resp = await fetch(dataUrl)
  const blob = await resp.blob()
  return URL.createObjectURL(blob)
}

async function handleTranslate(img, wrap, btn) {
  let state = wrapState.get(wrap)
  if (!state) {
    state = { img, originalSrc: img.src }
    wrapState.set(wrap, state)
  }

  btn.textContent = '번역중...'
  btn.disabled = true

  try {
    const result = await sendRequest({ type: 'translateRender', imageUrl: state.originalSrc })

    if (!result.rendered) {
      btn.textContent = '텍스트 없음'
      btn.disabled = false
      setTimeout(() => { btn.textContent = state.translatedSrc ? '다시 번역' : '번역' }, 2000)
      return
    }

    // data URL을 blob URL로 한 번만 변환해 캐싱 (토글/재사용 시 재디코딩 방지)
    const blobUrl = await dataUrlToBlobUrl(result.rendered)
    if (state.translatedSrc && state.translatedSrc.startsWith('blob:')) {
      URL.revokeObjectURL(state.translatedSrc)
    }

    state.bubbles = result.bubbles || []
    state.translatedSrc = blobUrl
    img.src = blobUrl

    btn.textContent = '다시 번역'
    btn.disabled = false

    ensureToggleButton(img, wrap, state)
    ensureDownloadButton(wrap, state)
  } catch (e) {
    console.warn('번역 실패:', e)
    btn.textContent = '실패'
    btn.disabled = false
    setTimeout(() => { btn.textContent = state.translatedSrc ? '다시 번역' : '번역' }, 2000)
  }
}

function sendRequest(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (res?.ok) resolve(res.data)
      else reject(new Error(res?.error || 'failed'))
    })
  })
}

function ensureToggleButton(img, wrap, state) {
  if (wrap.querySelector('.mtl-toggle-btn')) return
  const toggle = document.createElement('button')
  toggle.className = 'mtl-toggle-btn'
  toggle.textContent = '원본'
  let showingOriginal = false
  toggle.addEventListener('click', (e) => {
    e.stopPropagation()
    showingOriginal = !showingOriginal
    img.src = showingOriginal ? state.originalSrc : state.translatedSrc
    toggle.textContent = showingOriginal ? '번역본' : '원본'
  })
  getToolbar(wrap).appendChild(toggle)
}

function ensureDownloadButton(wrap, state) {
  if (wrap.querySelector('.mtl-download-btn')) return
  const btn = document.createElement('button')
  btn.className = 'mtl-download-btn'
  btn.textContent = '저장'
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!state.translatedSrc) return
    const a = document.createElement('a')
    a.href = state.translatedSrc
    a.download = 'translated.jpg'
    a.click()
  })
  getToolbar(wrap).appendChild(btn)
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translateAll') {
    // 페이지에 보이는 모든 번역 버튼을 순차적으로(약간의 간격으로) 클릭
    const btns = Array.from(document.querySelectorAll('.mtl-translate-btn'))
      .filter(b => !b.disabled && b.textContent === '번역')
    btns.forEach((btn, i) => {
      setTimeout(() => btn.click(), i * 100)
    })
  }
})

addTranslateButtons()

let debounceTimer = null
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(addTranslateButtons, 300)
})
observer.observe(document.body, { childList: true, subtree: true })
