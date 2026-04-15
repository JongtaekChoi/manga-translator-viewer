const FONT_FAMILY = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif'

export async function exportTranslatedImage(imageSrc, bubbles) {
  const img = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0)

  for (const b of bubbles) {
    if (!b.ko) continue
    const x = b.box.x / 100 * canvas.width
    const y = b.box.y / 100 * canvas.height
    const w = b.box.w / 100 * canvas.width
    const h = b.box.h / 100 * canvas.height
    if (w < 10 || h < 10) continue

    // 원본 텍스트 영역 흰색으로 채우기
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x, y, w, h)

    // 한국어 텍스트 렌더링
    const fontSize = fitTextToBox(ctx, b.ko, w - 4, h - 4)
    ctx.fillStyle = '#000000'
    ctx.font = `bold ${fontSize}px ${FONT_FAMILY}`
    renderWrappedText(ctx, b.ko, x + 2, y, w - 4, h, fontSize)
  }

  return canvas.toDataURL('image/png')
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function fitTextToBox(ctx, text, maxW, maxH) {
  for (let size = 24; size >= 8; size--) {
    ctx.font = `bold ${size}px ${FONT_FAMILY}`
    const lines = wrapText(ctx, text, maxW)
    const totalH = lines.length * (size + 3)
    if (totalH <= maxH) return size
  }
  return 8
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

function renderWrappedText(ctx, text, x, y, maxW, boxH, fontSize) {
  const lines = wrapText(ctx, text, maxW)
  const lineH = fontSize + 3
  const totalH = lines.length * lineH
  const startY = y + (boxH - totalH) / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const centerX = x + maxW / 2

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], centerX, startY + i * lineH)
  }
}
