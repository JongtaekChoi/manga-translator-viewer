// 만화 이미지에 번역 오버레이를 추가하는 Content Script

const MIN_IMG_SIZE = 200 // 최소 이미지 크기 (px)
const TRANSLATED_ATTR = 'data-manga-translated'
const WRAP_CLASS = 'mtl-img-wrap'

// 이미지에 번역 버튼 추가
function addTranslateButtons() {
  const images = document.querySelectorAll('img')

  images.forEach(img => {
    if (img.getAttribute(TRANSLATED_ATTR)) return
    if (img.closest(`.${WRAP_CLASS}`)) return
    if (img.naturalWidth < MIN_IMG_SIZE || img.naturalHeight < MIN_IMG_SIZE) return

    // 이미지를 wrapper로 감싸기
    const wrap = document.createElement('div')
    wrap.className = WRAP_CLASS
    img.parentNode.insertBefore(wrap, img)
    wrap.appendChild(img)

    // 번역 버튼
    const btn = document.createElement('button')
    btn.className = 'mtl-translate-btn'
    btn.textContent = '번역'
    btn.addEventListener('click', () => handleTranslate(img, wrap, btn))
    wrap.appendChild(btn)
  })
}

async function handleTranslate(img, wrap, btn) {
  btn.textContent = '번역중...'
  btn.disabled = true

  // 이미지 URL 결정
  const imageUrl = img.src

  chrome.runtime.sendMessage(
    { type: 'translate', imageUrl },
    (res) => {
      if (!res?.ok || !res.data?.bubbles?.length) {
        btn.textContent = res?.ok ? '대사 없음' : '실패'
        btn.disabled = false
        setTimeout(() => { btn.textContent = '번역' }, 2000)
        return
      }

      img.setAttribute(TRANSLATED_ATTR, '1')
      btn.textContent = '번역완료'

      const bubbles = res.data.bubbles
      renderOverlays(img, wrap, bubbles)

      // 내보내기 버튼 추가
      const exportBtn = document.createElement('button')
      exportBtn.className = 'mtl-export-btn'
      exportBtn.textContent = '내보내기'
      exportBtn.addEventListener('click', () => handleExport(imageUrl, bubbles, exportBtn))
      wrap.appendChild(exportBtn)
    }
  )
}

function renderOverlays(img, wrap, bubbles) {
  // 기존 오버레이 제거
  wrap.querySelectorAll('.mtl-bubble').forEach(el => el.remove())

  bubbles.forEach((b, i) => {
    if (!b.ko) return

    const overlay = document.createElement('div')
    overlay.className = 'mtl-bubble'
    overlay.style.left = `${b.box.x}%`
    overlay.style.top = `${b.box.y}%`
    overlay.style.width = `${b.box.w}%`
    overlay.style.height = `${b.box.h}%`

    const text = document.createElement('span')
    text.className = 'mtl-bubble-text'
    text.textContent = b.ko
    overlay.appendChild(text)

    // 터치/클릭으로 토글
    overlay.addEventListener('click', (e) => {
      e.stopPropagation()
      overlay.classList.toggle('active')
    })

    wrap.appendChild(overlay)
  })
}

function handleExport(imageUrl, bubbles, btn) {
  btn.textContent = '생성중...'
  btn.disabled = true

  chrome.runtime.sendMessage(
    { type: 'export', imageUrl, bubbles },
    (res) => {
      btn.disabled = false
      if (!res?.ok) {
        btn.textContent = '실패'
        setTimeout(() => { btn.textContent = '내보내기' }, 2000)
        return
      }

      // 다운로드
      const a = document.createElement('a')
      a.href = res.dataUrl
      a.download = 'translated.jpg'
      a.click()
      btn.textContent = '내보내기'
    }
  )
}

// 팝업에서 "전체 번역" 메시지 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translateAll') {
    document.querySelectorAll('.mtl-translate-btn').forEach(btn => {
      if (!btn.disabled) btn.click()
    })
  }
})

// 페이지 로드 후 실행 + 동적 이미지 감지
addTranslateButtons()

const observer = new MutationObserver(() => {
  addTranslateButtons()
})
observer.observe(document.body, { childList: true, subtree: true })
