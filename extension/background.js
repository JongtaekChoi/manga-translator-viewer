// OpenAI Vision API를 직접 호출하는 백그라운드 서비스 워커

const TRANSLATE_SYSTEM_PROMPT = `만화 이미지 분석 및 번역 전문가. 이 만화 페이지의 모든 말풍선(speech bubble)을 찾아서 일본어 텍스트를 읽고 한국어로 번역한다.

규칙:
- 모든 말풍선의 위치를 이미지 전체 크기 대비 백분율(%)로 반환
- 일본어 텍스트를 정확히 읽어서 text 필드에 기록
- 한국어 번역을 ko 필드에 기록
- 캐릭터의 말투와 감정을 살려서 자연스럽게 번역
- 효과음은 그대로 음역
- 만화의 읽는 순서(오른쪽→왼쪽, 위→아래)대로 정렬
- 말풍선이 없으면 빈 배열 반환

반드시 아래 JSON 형식으로만 응답:
{
  "bubbles": [
    {
      "text": "日本語テキスト",
      "ko": "한국어 번역",
      "box": { "x": 10.5, "y": 20.3, "w": 15.2, "h": 12.8 }
    }
  ]
}

box 좌표 설명: x=왼쪽 위 X좌표(%), y=왼쪽 위 Y좌표(%), w=너비(%), h=높이(%)`

async function getSettings() {
  const data = await chrome.storage.local.get(['openai_api_key', 'openai_model', 'currentWork', 'contexts'])
  return {
    apiKey: data.openai_api_key || '',
    model: data.openai_model || 'gpt-4o-mini',
    context: (data.currentWork && data.contexts?.[data.currentWork]) || ''
  }
}

async function imageUrlToBase64(url) {
  const resp = await fetch(url)
  const blob = await resp.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function clamp(v) {
  return Math.max(0, Math.min(100, v))
}

async function translateImage(apiKey, imageBase64, context, model) {
  const systemContent = context
    ? `${TRANSLATE_SYSTEM_PROMPT}\n\n[작품 정보]\n${context}`
    : TRANSLATE_SYSTEM_PROMPT

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemContent },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: imageBase64, detail: 'high' } },
            { type: 'text', text: '이 만화 페이지의 모든 말풍선을 찾아서 일본어 텍스트를 읽고 한국어로 번역해줘. JSON으로만 응답해.' }
          ]
        }
      ]
    })
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error: ${res.status}`)
  }

  const data = await res.json()
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
  const bubbles = Array.isArray(parsed.bubbles) ? parsed.bubbles : []

  return bubbles.map(b => ({
    text: String(b.text || ''),
    ko: String(b.ko || ''),
    box: {
      x: clamp(Number(b.box?.x) || 0),
      y: clamp(Number(b.box?.y) || 0),
      w: clamp(Number(b.box?.w) || 0),
      h: clamp(Number(b.box?.h) || 0),
    }
  }))
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'translate') {
    (async () => {
      try {
        const { apiKey, model, context } = await getSettings()
        if (!apiKey) throw new Error('API 키가 설정되지 않았습니다. 팝업에서 설정하세요.')
        const base64 = await imageUrlToBase64(msg.imageUrl)
        const bubbles = await translateImage(apiKey, base64, context, model)
        sendResponse({ ok: true, data: { bubbles } })
      } catch (e) {
        sendResponse({ ok: false, error: e.message })
      }
    })()
    return true
  }

  if (msg.type === 'health') {
    chrome.storage.local.get('openai_api_key', (data) => {
      sendResponse({ ok: true, data: { hasKey: !!data.openai_api_key } })
    })
    return true
  }

  if (msg.type === 'generateContext') {
    (async () => {
      try {
        const { apiKey, model } = await getSettings()
        if (!apiKey) throw new Error('API 키가 설정되지 않았습니다')
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            messages: [{
              role: 'user',
              content: `만화/웹툰 "${msg.workName}"의 번역에 필요한 정보를 정리해줘.\n\n아래 항목을 포함해서 간결하게 작성:\n1. 주요 캐릭터 이름 (일본어 → 한국어 공식 명칭)\n2. 주요 용어/고유명사 (일본어 → 한국어)\n3. 캐릭터별 말투 특징 (반말/존댓말, 특유의 어투)\n4. 세계관 핵심 설정 (한 줄 요약)\n\n간결하게, 번역 참고용으로만 작성해.`
            }]
          })
        })
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const data = await res.json()
        const context = data.choices?.[0]?.message?.content || ''
        sendResponse({ ok: true, context })
      } catch (e) {
        sendResponse({ ok: false, error: e.message })
      }
    })()
    return true
  }
})
