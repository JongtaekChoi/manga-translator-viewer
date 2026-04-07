const SERVER_URL = 'http://localhost:8789'

// 현재 작품 컨텍스트 가져오기
function getCurrentContext() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentWork', 'contexts'], (data) => {
      const name = data.currentWork || ''
      const ctx = name && data.contexts?.[name] ? data.contexts[name] : ''
      resolve(ctx)
    })
  })
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'translate') {
    getCurrentContext().then(context => {
      return fetch(`${SERVER_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: msg.imageUrl, context })
      })
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true
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

  if (msg.type === 'generateContext') {
    fetch(`${SERVER_URL}/generate-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workName: msg.workName })
    })
      .then(r => r.json())
      .then(data => {
        if (data.context) {
          sendResponse({ ok: true, context: data.context })
        } else {
          sendResponse({ ok: false, error: data.error || 'no context' })
        }
      })
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true
  }
})
