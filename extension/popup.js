const dot = document.getElementById('dot')
const statusText = document.getElementById('status-text')
const info = document.getElementById('info')
const translateAllBtn = document.getElementById('translate-all')

// 서버 상태 확인
chrome.runtime.sendMessage({ type: 'health' }, (res) => {
  if (res?.ok) {
    dot.className = 'dot ok'
    statusText.textContent = '서버 연결됨'
    info.textContent = res.data.openai
      ? 'OpenAI API 활성'
      : 'Google Translate 사용 중'
    translateAllBtn.disabled = false
  } else {
    dot.className = 'dot err'
    statusText.textContent = '서버 연결 실패'
    info.textContent = 'Python 서버가 실행 중인지 확인하세요.\npython scripts/ocr_server.py'
    translateAllBtn.disabled = true
  }
})

// 현재 페이지 전체 번역
translateAllBtn.addEventListener('click', async () => {
  translateAllBtn.textContent = '번역 시작...'
  translateAllBtn.disabled = true

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  chrome.tabs.sendMessage(tab.id, { type: 'translateAll' })

  translateAllBtn.textContent = '번역 요청됨'
  setTimeout(() => window.close(), 500)
})
