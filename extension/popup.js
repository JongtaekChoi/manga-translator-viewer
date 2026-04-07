const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const translateAllBtn = document.getElementById('translate-all')
const workNameInput = document.getElementById('work-name')
const contextArea = document.getElementById('context')
const saveCtxBtn = document.getElementById('save-ctx')
const generateCtxBtn = document.getElementById('generate-ctx')
const savedMsg = document.getElementById('saved-msg')

// 서버 상태 확인
chrome.runtime.sendMessage({ type: 'health' }, (res) => {
  if (res?.ok) {
    dot.className = 'dot ok'
    statusText.textContent = '서버 연결됨'
    info.textContent = res.data.openai ? 'OpenAI API 활성' : 'Google Translate 사용 중'
    translateAllBtn.disabled = false
  } else {
    dot.className = 'dot err'
    statusText.textContent = '서버 연결 실패'
    info.textContent = 'Python 서버가 실행 중인지 확인하세요.'
    translateAllBtn.disabled = true
  }
})

// 저장된 작품 컨텍스트 로드
chrome.storage.local.get(['currentWork', 'contexts'], (data) => {
  const current = data.currentWork || ''
  workNameInput.value = current
  if (current && data.contexts?.[current]) {
    contextArea.value = data.contexts[current]
  }
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
  // 현재 작품명 저장
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
