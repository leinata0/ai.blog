import { getToken } from './auth'

const BASE = ''
const TIMEOUT = 30000

async function request(method, path, { body, auth = false, timeout = TIMEOUT } = {}) {
  const headers = {}
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth) {
    const token = getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(text || `HTTP ${resp.status}`)
    }
    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('json')) return resp.json()
    return resp.text()
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') throw new Error('请求超时，请稍后重试')
    throw err
  }
}

export const apiGet = (path, opts) => request('GET', path, opts)
export const apiPost = (path, body, opts) => request('POST', path, { body, ...opts })
export const apiPut = (path, body, opts) => request('PUT', path, { body, ...opts })
export const apiDelete = (path, opts) => request('DELETE', path, opts)
