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
    const result = await sendRequest({
      type: 'translateRender',
      imageUrl: state.originalSrc,
      referer: location.href,
    })

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

let debounceTimer = null
let observer = null

function startExtension() {
  if (observer) return
  addTranslateButtons()
  observer = new MutationObserver(() => {
    clearTimeout(debounceTimer)
    debounceTimer = setTimeout(addTranslateButtons, 300)
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

function stopExtension() {
  if (observer) {
    observer.disconnect()
    observer = null
  }
  clearTimeout(debounceTimer)
  // 기존에 삽입한 wrap/버튼/오버레이 모두 제거하고 img를 원래 자리로 복귀
  document.querySelectorAll(`.${WRAP_CLASS}`).forEach(wrap => {
    const img = wrap.querySelector('img')
    if (img && wrap.parentNode) {
      // translatedSrc를 사용 중이었다면 원본 src로 복원
      const state = wrapState.get(wrap)
      if (state?.originalSrc && img.src !== state.originalSrc) {
        img.src = state.originalSrc
      }
      if (state?.translatedSrc?.startsWith('blob:')) {
        URL.revokeObjectURL(state.translatedSrc)
      }
      wrap.parentNode.insertBefore(img, wrap)
      wrap.remove()
    } else {
      wrap.remove()
    }
  })
}

async function isHostEnabled() {
  try {
    const data = await chrome.storage.local.get(['enabled_hosts'])
    return (data.enabled_hosts || []).includes(location.hostname)
  } catch {
    return false
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'hostToggle') {
    if (msg.enabled) startExtension()
    else stopExtension()
  } else if (msg.type === 'translateAll') {
    const btns = Array.from(document.querySelectorAll('.mtl-translate-btn'))
      .filter(b => !b.disabled && b.textContent === '번역')
    btns.forEach((btn, i) => {
      setTimeout(() => btn.click(), i * 100)
    })
  }
})

// 초기 시작: 현재 호스트가 활성화 목록에 있을 때만
isHostEnabled().then(enabled => {
  if (enabled) startExtension()
})
