import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../src/api/auth', () => ({ getToken: () => null, clearToken: () => {} }))
vi.mock('../src/api/userAuth', () => ({ getUserToken: () => null, clearUserToken: () => {} }))
vi.mock('../src/api/base', () => ({ resolveApiBase: () => '', buildApiUrl: (p) => p }))

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let apiGet

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  window.sessionStorage.clear()
  ;({ apiGet } = await import('../src/api/client'))
})

it('does not hand a forceRefresh caller the swallowed result of a failing background refresh', async () => {
  let call = 0
  let failBackgroundRefresh
  global.fetch = vi.fn(() => {
    call += 1
    if (call === 1) return Promise.resolve(jsonResponse({ author_name: 'Cached Author' }))
    if (call === 2) {
      return new Promise((_resolve, reject) => {
        failBackgroundRefresh = () => reject(new Error('backend down'))
      })
    }
    return Promise.resolve(jsonResponse({ author_name: 'Fresh Author' }))
  })

  const swrOptions = { cache: true, cacheTtl: 0, staleTtl: 180000, staleWhileRevalidate: true }

  // 1. Prime the cache.
  await expect(apiGet('/api/settings', swrOptions)).resolves.toEqual({ author_name: 'Cached Author' })

  // 2. Stale read kicks off a background revalidation and returns the cached value.
  await expect(apiGet('/api/settings', swrOptions)).resolves.toEqual({ author_name: 'Cached Author' })
  expect(call).toBe(2)

  // 3. refreshSettings() style call while that background request is still in flight.
  const forced = apiGet('/api/settings', { forceRefresh: true })

  failBackgroundRefresh()
  await flush()

  // The forceRefresh caller must never resolve with `null` (which used to blank the
  // whole site: settings -> null -> author/site_url/sidebar gone, silently).
  await expect(forced).resolves.toEqual({ author_name: 'Fresh Author' })
})

it('a rejected background refresh rejects dedupe callers instead of resolving null', async () => {
  let call = 0
  let rejectRefresh
  global.fetch = vi.fn(() => {
    call += 1
    if (call === 1) return Promise.resolve(jsonResponse({ version: 'cached' }))
    return new Promise((_resolve, reject) => {
      rejectRefresh = () => reject(new Error('backend down'))
    })
  })

  const swrOptions = { cache: true, cacheTtl: 0, staleTtl: 180000, staleWhileRevalidate: true }
  await apiGet('/api/stats', swrOptions)
  await apiGet('/api/stats', swrOptions)
  expect(call).toBe(2)

  // A plain (non-forceRefresh, non-cacheable) dedupe caller joins the inflight request.
  const joined = apiGet('/api/stats', { cache: false })
  rejectRefresh()

  await expect(joined).rejects.toThrow('backend down')
})

it('does not resolve a forceRefresh call from a request that started earlier', async () => {
  let call = 0
  const resolvers = []
  global.fetch = vi.fn(() => {
    call += 1
    const index = call
    return new Promise((resolve) => {
      resolvers.push(() => resolve(jsonResponse({ order: index })))
    })
  })

  const first = apiGet('/api/posts', { cache: false })
  const forced = apiGet('/api/posts', { cache: false, forceRefresh: true })

  expect(call).toBe(2)
  resolvers.forEach((resolve) => resolve())

  await expect(first).resolves.toEqual({ order: 1 })
  await expect(forced).resolves.toEqual({ order: 2 })
})

it('reuses an inflight request for ordinary dedupe callers', async () => {
  let call = 0
  global.fetch = vi.fn(() => {
    call += 1
    return Promise.resolve(jsonResponse({ call }))
  })

  const [a, b] = await Promise.all([
    apiGet('/api/topics', { cache: false }),
    apiGet('/api/topics', { cache: false }),
  ])

  expect(call).toBe(1)
  expect(a).toEqual(b)
})
