const KEY_API = 'openai_api_key'
const KEY_MODEL = 'openai_model'
const KEY_CTX = 'manga_ctx'
const KEY_TRANSLATIONS = 'manga_translations'

export function saveApiKey(key) {
  localStorage.setItem(KEY_API, key)
}

export function getApiKey() {
  return localStorage.getItem(KEY_API) || ''
}

export function saveModel(model) {
  localStorage.setItem(KEY_MODEL, model)
}

export function getModel() {
  return localStorage.getItem(KEY_MODEL) || 'gpt-4o-mini'
}

export function saveContext(workName, context) {
  const data = { workName, context }
  localStorage.setItem(KEY_CTX, JSON.stringify(data))
}

export function loadContext() {
  try {
    return JSON.parse(localStorage.getItem(KEY_CTX) || '{}')
  } catch {
    return {}
  }
}

export function saveTranslation(sourceKey, pages) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_TRANSLATIONS) || '{}')
    all[sourceKey] = { updatedAt: new Date().toISOString(), pages }
    localStorage.setItem(KEY_TRANSLATIONS, JSON.stringify(all))
  } catch {}
}

export function loadTranslation(sourceKey) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_TRANSLATIONS) || '{}')
    return all[sourceKey]?.pages || null
  } catch {
    return null
  }
}
