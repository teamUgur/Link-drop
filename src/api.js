// Клиент нашего API. Фронт ходит на относительный /api: в dev его проксирует Vite, в проде — Caddy.

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const NETWORK_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз'

// Текст на случай, когда тело ответа не наш JSON (прокси отдал HTML 502, обрыв посреди ответа).
const STATUS_MESSAGES = {
  413: 'Слишком длинная ссылка',
  429: 'Слишком много запросов, подождите минуту',
  502: 'Сервис временно недоступен, попробуйте позже',
  503: 'Сервер сейчас занят, попробуйте через минуту',
  504: 'Платформа слишком долго отвечает, попробуйте позже',
}

async function request(path, init) {
  try {
    return await fetch(path, init)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new ApiError('NETWORK', NETWORK_MESSAGE, 0)
  }
}

async function errorFromResponse(response) {
  try {
    const body = await response.json()
    if (body?.error?.message) return new ApiError(body.error.code, body.error.message, response.status)
  } catch {
    // Тело не JSON — ниже сообщение по статусу.
  }
  return new ApiError('HTTP_' + response.status, STATUS_MESSAGES[response.status] ?? 'Что-то пошло не так, попробуйте ещё раз', response.status)
}

const jsonPost = (path, body, signal) =>
  request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })

export async function checkHealth(signal) {
  try {
    const response = await fetch('/api/health', { signal })
    return response.ok
  } catch (error) {
    if (error.name === 'AbortError') throw error
    return false
  }
}

export async function resolveMedia(url, signal) {
  const response = await jsonPost('/api/media/resolve', { url }, signal)
  if (!response.ok) throw await errorFromResponse(response)
  return response.json()
}

// Готовит файл на сервере. Ответ — NDJSON: started, progress…, затем ready или error.
// Возвращает событие ready ({ fileUrl, fileName, sizeBytes }); onEvent получает все промежуточные.
export async function prepareFile({ url, format }, { signal, onEvent }) {
  const response = await jsonPost('/api/media/prepare', { url, format }, signal)
  if (!response.ok) throw await errorFromResponse(response)

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        const event = JSON.parse(line)
        if (event.type === 'ready') return event
        if (event.type === 'error') throw new ApiError(event.error.code, event.error.message, 200)
        onEvent?.(event)
      }
    }
  } catch (error) {
    if (error instanceof ApiError || error.name === 'AbortError') throw error
    throw new ApiError('NETWORK', NETWORK_MESSAGE, 0)
  } finally {
    reader.releaseLock()
  }
  // Поток закрылся без ready/error — сервер перезапустился или оборвалась связь.
  throw new ApiError('NETWORK', 'Соединение прервалось, попробуйте ещё раз', 0)
}
