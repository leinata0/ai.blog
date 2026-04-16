import { getToken, clearToken } from './auth'

const BASE = ''
const TIMEOUT = 30000
const GET_CACHE_TTL = 15000
const GET_STALE_TTL = 60000

const getCache = new Map()
const inflightGet = new Map()

function isAbortError(err) {
  return err?.name === 'AbortError' || /aborted|canceled|cancelled/i.test(String(err?.message || ''))
}

function createAbortError(message) {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function mergeAbortSignals(signals) {
  const controller = new AbortController()
  const cleanups = []

  const relay = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  signals.filter(Boolean).forEach((signal) => {
    if (signal.aborted) {
      relay()
      return
    }

    const onAbort = () => relay()
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', onAbort))
  })

  return {
    signal: controller.signal,
    cleanup: () => cleanups.forEach((cleanup) => cleanup()),
  }
}

function readCacheEntry(cacheKey, now) {
  const entry = getCache.get(cacheKey)
  if (!entry) return null

  if (entry.staleUntil <= now) {
    getCache.delete(cacheKey)
    return null
  }

  return entry
}

function writeCacheEntry(cacheKey, data, cacheTtl, staleTtl) {
  const now = Date.now()
  getCache.set(cacheKey, {
    data,
    expiresAt: now + cacheTtl,
    staleUntil: now + Math.max(staleTtl, cacheTtl),
  })
}

function requestGetKey(path, auth) {
  if (!auth) return `public:${path}`
  const token = getToken() || 'anonymous'
  return `auth:${token}:${path}`
}

async function request(method, path, { body, auth = false, timeout = TIMEOUT, signal } = {}) {
  const headers = {}
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const timeoutController = new AbortController()
  const merged = mergeAbortSignals([timeoutController.signal, signal])
  const timer = setTimeout(() => timeoutController.abort(), timeout)

  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal: merged.signal,
    })

    clearTimeout(timer)
    merged.cleanup()

    if (!resp.ok) {
      if (resp.status === 401 && auth) {
        clearToken()
        window.location.href = '/admin/login'
        return
      }
      const text = await resp.text().catch(() => '')
      throw new Error(text || `HTTP ${resp.status}`)
    }

    const contentType = resp.headers.get('content-type') || ''
    if (contentType.includes('json')) return resp.json()
    return resp.text()
  } catch (err) {
    clearTimeout(timer)
    merged.cleanup()
    if (isAbortError(err)) {
      if (signal?.aborted) throw createAbortError('请求已取消')
      throw createAbortError('请求超时，请稍后重试')
    }
    throw err
  }
}

async function requestGetNetwork(path, options, cacheKey, cacheConfig) {
  const response = await request('GET', path, options)
  if (cacheConfig.enabled) {
    writeCacheEntry(cacheKey, response, cacheConfig.cacheTtl, cacheConfig.staleTtl)
  }
  return response
}

export function apiGet(path, opts = {}) {
  const auth = Boolean(opts.auth)
  const cacheEnabled = opts.cache === true || (opts.cache !== false && !auth)
  const dedupeEnabled = opts.dedupe !== false
  const cacheTtl = Number.isFinite(opts.cacheTtl) ? Math.max(0, opts.cacheTtl) : GET_CACHE_TTL
  const staleTtl = Number.isFinite(opts.staleTtl) ? Math.max(cacheTtl, opts.staleTtl) : GET_STALE_TTL
  const staleWhileRevalidate = Boolean(opts.staleWhileRevalidate)
  const forceRefresh = Boolean(opts.forceRefresh)
  const cacheKey = requestGetKey(path, auth)
  const now = Date.now()
  const cacheConfig = { enabled: cacheEnabled, cacheTtl, staleTtl }

  if (cacheEnabled && !forceRefresh) {
    const cached = readCacheEntry(cacheKey, now)
    if (cached?.expiresAt > now) {
      return Promise.resolve(cached.data)
    }
    if (cached && staleWhileRevalidate) {
      if (!inflightGet.has(cacheKey)) {
        const refreshPromise = requestGetNetwork(path, { ...opts, signal: undefined }, cacheKey, cacheConfig)
          .catch(() => null)
          .finally(() => inflightGet.delete(cacheKey))
        inflightGet.set(cacheKey, refreshPromise)
      }
      return Promise.resolve(cached.data)
    }
  }

  if (dedupeEnabled && inflightGet.has(cacheKey)) {
    return inflightGet.get(cacheKey)
  }

  const requestPromise = requestGetNetwork(path, opts, cacheKey, cacheConfig).finally(() => {
    inflightGet.delete(cacheKey)
  })

  if (dedupeEnabled) {
    inflightGet.set(cacheKey, requestPromise)
  }

  return requestPromise
}

export function apiPrefetchGet(path, opts = {}) {
  return apiGet(path, {
    ...opts,
    staleWhileRevalidate: opts.staleWhileRevalidate ?? true,
  })
    .then(() => undefined)
    .catch(() => undefined)
}

export function clearApiGetCache(matchPath = null) {
  if (!matchPath) {
    getCache.clear()
    return
  }

  for (const key of getCache.keys()) {
    if (typeof matchPath === 'string' && key.includes(matchPath)) {
      getCache.delete(key)
      continue
    }
    if (matchPath instanceof RegExp && matchPath.test(key)) {
      getCache.delete(key)
    }
  }
}

export async function apiPost(path, body, opts) {
  const result = await request('POST', path, { body, ...opts })
  clearApiGetCache()
  return result
}

export async function apiPut(path, body, opts) {
  const result = await request('PUT', path, { body, ...opts })
  clearApiGetCache()
  return result
}

export async function apiDelete(path, opts) {
  const result = await request('DELETE', path, opts)
  clearApiGetCache()
  return result
}
