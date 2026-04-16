// 로컬 서버(scripts/ocr_server.py)를 호출하는 백그라운드 서비스 워커

const DEFAULT_SERVER = 'http://localhost:8789'

async function getSettings() {
  const data = await chrome.storage.local.get(['server_url', 'openai_model', 'currentWork', 'contexts'])
  const server = (data.server_url || DEFAULT_SERVER).replace(/\/$/, '')
  return {
    server,
    model: data.openai_model || '',
    context: (data.currentWork && data.contexts?.[data.currentWork]) || ''
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'translateRender') {
    (async () => {
      try {
        const { server, context, model } = await getSettings()
        const res = await fetch(`${server}/translate-render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: msg.imageUrl, context, model, referer: msg.referer })
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `server error: ${res.status}`)
        }
        const data = await res.json()
        sendResponse({ ok: true, data })
      } catch (e) {
        sendResponse({ ok: false, error: e.message })
      }
    })()
    return true
  }

  if (msg.type === 'generateContext') {
    (async () => {
      try {
        const { server, model } = await getSettings()
        const res = await fetch(`${server}/generate-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workName: msg.workName, model })
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || `server error: ${res.status}`)
        }
        const data = await res.json()
        sendResponse({ ok: true, context: data.context || '' })
      } catch (e) {
        sendResponse({ ok: false, error: e.message })
      }
    })()
    return true
  }
})
