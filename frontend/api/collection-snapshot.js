import { createCollectionSnapshot, serializeCollectionSnapshot } from '../src/utils/publicCollectionSnapshot.js'

// This is a public summary endpoint, not a general proxy. Both the host and every
// upstream query are fixed so request headers and query strings cannot select
// private content or turn the function into an open proxy.
const UPSTREAMS = Object.freeze({
  daily: 'https://ai-blog-hbur.onrender.com/api/discover?content_type=daily_brief&sections=items%2Ctotal&limit=24',
  weekly: 'https://ai-blog-hbur.onrender.com/api/discover?content_type=weekly_review&sections=items%2Ctotal&limit=24',
  topics: 'https://ai-blog-hbur.onrender.com/api/topics?limit=24',
  series: 'https://ai-blog-hbur.onrender.com/api/series?limit=24',
})

export const UPSTREAM_TIMEOUT_MS = 5000
export const UPSTREAM_MAX_BYTES = 1024 * 1024
const CACHE_POLICY = 'public, max-age=60, stale-while-revalidate=120'

function hasHeader(request, name) {
  if (typeof request.headers?.has === 'function') return request.headers.has(name)
  return Object.keys(request.headers || {}).some((key) => key.toLowerCase() === name)
}

function collectionRoute(request) {
  const url = new URL(request.url, 'https://www.563118077.xyz')
  const query = request.query || {}
  if ([...url.searchParams.keys(), ...Object.keys(query)].some((key) => key !== 'route')) return null
  const rawValues = url.searchParams.getAll('route')
  if (rawValues.length > 1) return null
  const queryValue = Object.hasOwn(query, 'route') ? query.route : undefined
  if (queryValue !== undefined && typeof queryValue !== 'string') return null
  if (queryValue !== undefined && rawValues.length && queryValue !== rawValues[0]) return null
  const alias = /^\/public-data\/(daily|weekly|topics|series)\.json$/.exec(url.pathname)?.[1]
  const route = queryValue ?? rawValues[0] ?? alias
  if (alias && route !== alias) return null
  return typeof route === 'string' && Object.hasOwn(UPSTREAMS, route) ? route : null
}

function send(response, status, body, cacheable = false) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cache-Control', cacheable ? 'public, max-age=0, must-revalidate' : 'private, no-store')
  response.setHeader('CDN-Cache-Control', 'no-store')
  response.setHeader('Vercel-CDN-Cache-Control', cacheable ? CACHE_POLICY : 'no-store')
  if (cacheable) response.setHeader('Vercel-Cache-Tag', 'public-collection-snapshots')
  response.end(body)
}

function publicJson(response) {
  const policy = response.headers.get('cache-control') || ''
  const directives = new Set(policy.toLowerCase().split(',').map((part) => part.trim().split('=')[0]))
  return response.status === 200
    && /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')
    && !response.headers.has('set-cookie')
    && directives.has('public')
    && !['private', 'no-store', 'no-cache'].some((directive) => directives.has(directive))
}

async function readJson(response, signal) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (declaredLength > UPSTREAM_MAX_BYTES) throw new Error('Upstream body is too large')
  if (!response.body) throw new Error('Missing upstream body')
  const reader = response.body.getReader()
  const cancel = () => { reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      if (signal.aborted) throw new Error('Upstream request aborted')
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > UPSTREAM_MAX_BYTES) throw new Error('Upstream body is too large')
      chunks.push(value)
    }
  } finally {
    // Cancellation is best-effort and must never extend the request deadline.
    signal.removeEventListener('abort', cancel)
    if (bytes > UPSTREAM_MAX_BYTES || signal.aborted) cancel()
    reader.releaseLock()
  }
  const body = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(body))
}

export default async function collectionSnapshot(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return send(response, 405, JSON.stringify({ error: 'Method not allowed' }))
  }
  let route
  try { route = collectionRoute(request) } catch { /* Invalid request URL. */ }
  if (!route) return send(response, 400, JSON.stringify({ error: 'Invalid collection route or parameters' }))

  const cacheable = !['authorization', 'cookie', 'range'].some((name) => hasHeader(request, name))
  const controller = new AbortController()
  const startedAt = Date.now()
  let timedOut = false
  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('Collection upstream timed out'))
    }, UPSTREAM_TIMEOUT_MS)
  })
  try {
    const body = await Promise.race([
      (async () => {
        const upstream = await fetch(UPSTREAMS[route], {
          method: 'GET', headers: { Accept: 'application/json' },
          credentials: 'omit', redirect: 'error', signal: controller.signal,
        })
        if (!publicJson(upstream)) throw new Error('Unsafe or unsuccessful public upstream response')
        const payload = await readJson(upstream, controller.signal)
        const items = Array.isArray(payload) ? payload : payload?.items
        if (!Array.isArray(items)) throw new Error('Invalid public collection payload')
        const snapshot = createCollectionSnapshot(`/${route}`, items)
        const serialized = serializeCollectionSnapshot(snapshot)
        if (!serialized) throw new Error('Public collection summary is too large')
        return serialized
      })(),
      deadline,
    ])
    if (Date.now() - startedAt >= UPSTREAM_TIMEOUT_MS) {
      timedOut = true
      throw new Error('Collection upstream timed out')
    }
    return send(response, 200, body, cacheable)
  } catch {
    controller.abort()
    return send(response, timedOut ? 504 : 502, JSON.stringify({ error: timedOut ? 'Collection temporarily timed out' : 'Collection temporarily unavailable' }))
  } finally {
    clearTimeout(timeout)
  }
}
