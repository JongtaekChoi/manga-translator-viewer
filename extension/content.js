// 만화 이미지에 번역 오버레이를 추가하는 Content Script

const MIN_IMG_SIZE = 200
const TRANSLATED_ATTR = 'data-manga-translated'
const WRAP_CLASS = 'mtl-img-wrap'

// 이미지에 번역 버튼 추가
function addTranslateButtons() {
  const images = document.querySelectorAll('img')

  images.forEach(img => {
    if (img.getAttribute(TRANSLATED_ATTR)) return
    if (img.closest(`.${WRAP_CLASS}`)) return
    if (img.naturalWidth < MIN_IMG_SIZE || img.naturalHeight < MIN_IMG_SIZE) return

    const wrap = document.createElement('div')
    wrap.className = WRAP_CLASS
    img.parentNode.insertBefore(wrap, img)
    wrap.appendChild(img)

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

  chrome.runtime.sendMessage(
    { type: 'translate', imageUrl: img.src },
    (res) => {
      if (!res?.ok || !res.data?.bubbles?.length) {
        btn.textContent = res?.ok ? '대사 없음' : '실패'
        btn.disabled = false
        if (res?.error) console.warn('번역 실패:', res.error)
        setTimeout(() => { btn.textContent = '번역' }, 2000)
        return
      }

      img.setAttribute(TRANSLATED_ATTR, '1')
      btn.textContent = '번역완료'

      const bubbles = res.data.bubbles
      renderOverlays(img, wrap, bubbles)

      const exportBtn = document.createElement('button')
      exportBtn.className = 'mtl-export-btn'
      exportBtn.textContent = '내보내기'
      exportBtn.addEventListener('click', () => handleExport(img.src, bubbles, exportBtn))
      wrap.appendChild(exportBtn)
    }
  )
}

function renderOverlays(img, wrap, bubbles) {
  wrap.querySelectorAll('.mtl-bubble').forEach(el => el.remove())

  bubbles.forEach((b) => {
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

    overlay.addEventListener('click', (e) => {
      e.stopPropagation()
      overlay.classList.toggle('active')
    })

    wrap.appendChild(overlay)
  })
}

// Canvas 기반 이미지 내보내기
async function handleExport(imageUrl, bubbles, btn) {
  btn.textContent = '생성중...'
  btn.disabled = true

  try {
    // 익스텐션에서는 fetch로 이미지를 가져와 blob URL로 변환
    const resp = await fetch(imageUrl)
    const blob = await resp.blob()
    const blobUrl = URL.createObjectURL(blob)

    const img = new Image()
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = blobUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(blobUrl)

    const fontFamily = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

    for (const b of bubbles) {
      if (!b.ko) continue
      const x = b.box.x / 100 * canvas.width
      const y = b.box.y / 100 * canvas.height
      const w = b.box.w / 100 * canvas.width
      const h = b.box.h / 100 * canvas.height
      if (w < 10 || h < 10) continue

      ctx.fillStyle = '#ffffff'
      ctx.fillRect(x, y, w, h)

      // 텍스트 크기 맞추기
      let fontSize = 8
      for (let size = 24; size >= 8; size--) {
        ctx.font = `bold ${size}px ${fontFamily}`
        const lines = wrapText(ctx, b.ko, w - 4)
        if (lines.length * (size + 3) <= h - 4) { fontSize = size; break }
      }

      ctx.font = `bold ${fontSize}px ${fontFamily}`
      ctx.fillStyle = '#000000'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'

      const lines = wrapText(ctx, b.ko, w - 4)
      const lineH = fontSize + 3
      const totalH = lines.length * lineH
      const startY = y + (h - totalH) / 2

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x + w / 2, startY + i * lineH)
      }
    }

    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = 'translated.png'
    a.click()
  } catch (e) {
    console.error('내보내기 실패:', e)
    alert('내보내기 실패: ' + e.message)
  } finally {
    btn.textContent = '내보내기'
    btn.disabled = false
  }
}

function wrapText(ctx, text, maxWidth) {
  const lines = []
  let current = ''
  for (const ch of text) {
    const test = current + ch
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = ch
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

// 팝업에서 "전체 번역" 메시지 수신
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'translateAll') {
    document.querySelectorAll('.mtl-translate-btn').forEach(btn => {
      if (!btn.disabled) btn.click()
    })
  }
})

// 페이지 로드 후 실행 + 동적 이미지 감지 (debounce 적용)
addTranslateButtons()

let debounceTimer = null
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(addTranslateButtons, 300)
})
observer.observe(document.body, { childList: true, subtree: true })
