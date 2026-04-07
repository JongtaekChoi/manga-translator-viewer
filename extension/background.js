const SERVER_URL = 'http://localhost:8789'

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'translate') {
    fetch(`${SERVER_URL}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: msg.imageUrl })
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true // async
  }

  if (msg.type === 'export') {
    fetch(`${SERVER_URL}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: msg.imageUrl, bubbles: msg.bubbles })
    })
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader()
        reader.onloadend = () => sendResponse({ ok: true, dataUrl: reader.result })
        reader.readAsDataURL(blob)
      })
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true
  }

  if (msg.type === 'health') {
    fetch(`${SERVER_URL}/health`)
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true
  }
})
