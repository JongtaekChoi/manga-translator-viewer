const DEFAULT_SERVER = 'http://localhost:8789'

const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const serverUrlInput = document.getElementById('server-url')
const saveServerBtn = document.getElementById('save-server')
const workNameInput = document.getElementById('work-name')
const contextArea = document.getElementById('context')
const saveCtxBtn = document.getElementById('save-ctx')
const generateCtxBtn = document.getElementById('generate-ctx')
const savedMsg = document.getElementById('saved-msg')
const savedWorksList = document.getElementById('saved-works')
const modelSelect = document.getElementById('model-select')

function refreshSavedWorks(contexts) {
  savedWorksList.innerHTML = ''
  Object.keys(contexts || {}).sort().forEach(name => {
    const opt = document.createElement('option')
    opt.value = name
    savedWorksList.appendChild(opt)
  })
}

function loadContextFor(name) {
  chrome.storage.local.get(['contexts'], (data) => {
    contextArea.value = data.contexts?.[name] || ''
  })
}

function checkServerHealth(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 2000)
  return fetch(url.replace(/\/$/, '') + '/health', {
    method: 'GET',
    signal: controller.signal
  })
    .then(res => res.ok ? res.json() : Promise.reject(res.status))
    .catch(() => null)
    .finally(() => clearTimeout(timeoutId))
}

async function refreshStatus(url) {
  statusText.textContent = '확인 중...'
  dot.className = 'dot'
  const health = await checkServerHealth(url)
  if (health) {
    dot.className = 'dot ok'
    statusText.textContent = '서버 연결됨'
    info.textContent = health.openai ? 'OpenAI 키 설정됨' : 'OpenAI 키 미설정 (Google 번역 사용)'
  } else {
    dot.className = 'dot err'
    statusText.textContent = '서버 연결 실패'
    info.textContent = '서버가 실행 중인지 확인하세요.'
  }
}

chrome.storage.local.get(['server_url', 'openai_model', 'currentWork', 'contexts'], (data) => {
  const url = data.server_url || DEFAULT_SERVER
  serverUrlInput.value = url
  refreshStatus(url)

  modelSelect.value = data.openai_model || 'gpt-4o-mini'

  refreshSavedWorks(data.contexts || {})

  const current = data.currentWork || ''
  workNameInput.value = current
  if (current && data.contexts?.[current]) {
    contextArea.value = data.contexts[current]
  }
})

modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ openai_model: modelSelect.value }, () => {
    savedMsg.style.display = 'block'
    setTimeout(() => { savedMsg.style.display = 'none' }, 1200)
  })
})

saveServerBtn.addEventListener('click', () => {
  let url = serverUrlInput.value.trim() || DEFAULT_SERVER
  url = url.replace(/\/$/, '')
  chrome.storage.local.set({ server_url: url }, () => {
    savedMsg.style.display = 'block'
    setTimeout(() => { savedMsg.style.display = 'none' }, 1500)
    refreshStatus(url)
  })
})

// datalist 선택 / 직접 입력 후 blur 양쪽에서 모두 동작
workNameInput.addEventListener('input', () => {
  const name = workNameInput.value.trim()
  if (!name) return
  chrome.storage.local.get(['contexts'], (data) => {
    // datalist에서 완전히 일치하는 이름 선택 시에만 로드 (타이핑 중엔 덮어쓰지 않음)
    if (data.contexts?.[name]) {
      contextArea.value = data.contexts[name]
    }
  })
})

saveCtxBtn.addEventListener('click', () => {
  const name = workNameInput.value.trim()
  if (!name) { alert('작품명을 입력하세요'); return }

  chrome.storage.local.get(['contexts'], (data) => {
    const contexts = data.contexts || {}
    contexts[name] = contextArea.value
    chrome.storage.local.set({ currentWork: name, contexts }, () => {
      refreshSavedWorks(contexts)
      savedMsg.style.display = 'block'
      setTimeout(() => { savedMsg.style.display = 'none' }, 1500)
    })
  })
})

const translateAllBtn = document.getElementById('translate-all')
translateAllBtn.addEventListener('click', async () => {
  translateAllBtn.textContent = '요청 전송...'
  translateAllBtn.disabled = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    await chrome.tabs.sendMessage(tab.id, { type: 'translateAll' })
    translateAllBtn.textContent = '전체 번역 시작됨'
    setTimeout(() => window.close(), 400)
  } catch (e) {
    translateAllBtn.textContent = '실패 (페이지 새로고침 필요)'
    setTimeout(() => {
      translateAllBtn.textContent = '현재 페이지 전체 번역'
      translateAllBtn.disabled = false
    }, 2500)
  }
})

generateCtxBtn.addEventListener('click', () => {
  const name = workNameInput.value.trim()
  if (!name) { alert('작품명을 입력하세요'); return }

  generateCtxBtn.textContent = '생성중...'
  generateCtxBtn.disabled = true

  chrome.runtime.sendMessage({ type: 'generateContext', workName: name }, (res) => {
    generateCtxBtn.textContent = 'AI 생성'
    generateCtxBtn.disabled = false
    if (res?.ok) {
      contextArea.value = res.context
    } else {
      alert('컨텍스트 생성 실패: ' + (res?.error || 'unknown'))
    }
  })
})
