const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const apiKeyInput = document.getElementById('api-key')
const saveKeyBtn = document.getElementById('save-key')
const modelSelect = document.getElementById('model-select')
const translateAllBtn = document.getElementById('translate-all')
const workNameInput = document.getElementById('work-name')
const contextArea = document.getElementById('context')
const saveCtxBtn = document.getElementById('save-ctx')
const generateCtxBtn = document.getElementById('generate-ctx')
const savedMsg = document.getElementById('saved-msg')

// 설정 로드
chrome.storage.local.get(['openai_api_key', 'openai_model', 'currentWork', 'contexts'], (data) => {
  if (data.openai_api_key) {
    apiKeyInput.value = data.openai_api_key
    dot.className = 'dot ok'
    statusText.textContent = 'API 키 설정됨'
    info.textContent = `모델: ${data.openai_model || 'gpt-4o-mini'}`
    translateAllBtn.disabled = false
  } else {
    dot.className = 'dot err'
    statusText.textContent = 'API 키 미설정'
    info.textContent = 'OpenAI API 키를 입력하세요.'
    translateAllBtn.disabled = true
  }

  modelSelect.value = data.openai_model || 'gpt-4o-mini'

  const current = data.currentWork || ''
  workNameInput.value = current
  if (current && data.contexts?.[current]) {
    contextArea.value = data.contexts[current]
  }
})

// API 키 저장
saveKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim()
  chrome.storage.local.set({ openai_api_key: key }, () => {
    dot.className = key ? 'dot ok' : 'dot err'
    statusText.textContent = key ? 'API 키 설정됨' : 'API 키 미설정'
    translateAllBtn.disabled = !key
    savedMsg.style.display = 'block'
    setTimeout(() => { savedMsg.style.display = 'none' }, 1500)
  })
})

// 모델 변경
modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ openai_model: modelSelect.value })
  info.textContent = `모델: ${modelSelect.value}`
})

// 작품명 변경 시 해당 컨텍스트 로드
workNameInput.addEventListener('change', () => {
  const name = workNameInput.value.trim()
  if (!name) return
  chrome.storage.local.get(['contexts'], (data) => {
    contextArea.value = data.contexts?.[name] || ''
  })
})

// 컨텍스트 저장
saveCtxBtn.addEventListener('click', () => {
  const name = workNameInput.value.trim()
  if (!name) { alert('작품명을 입력하세요'); return }

  chrome.storage.local.get(['contexts'], (data) => {
    const contexts = data.contexts || {}
    contexts[name] = contextArea.value
    chrome.storage.local.set({ currentWork: name, contexts }, () => {
      savedMsg.style.display = 'block'
      setTimeout(() => { savedMsg.style.display = 'none' }, 1500)
    })
  })
})

// AI로 컨텍스트 생성
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

// 현재 페이지 전체 번역
translateAllBtn.addEventListener('click', async () => {
  const name = workNameInput.value.trim()
  if (name) {
    chrome.storage.local.set({ currentWork: name })
  }

  translateAllBtn.textContent = '번역 시작...'
  translateAllBtn.disabled = true

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  chrome.tabs.sendMessage(tab.id, { type: 'translateAll' })

  translateAllBtn.textContent = '번역 요청됨'
  setTimeout(() => window.close(), 500)
})
