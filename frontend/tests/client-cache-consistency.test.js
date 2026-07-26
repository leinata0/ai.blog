import { beforeEach, expect, it, vi } from 'vitest'

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  window.sessionStorage.clear()
})

it('does not reuse or recache an invalidated inflight GET after a write', async () => {
  let resolveOldRequest
  let getCallCount = 0

  global.fetch = vi.fn((_url, options = {}) => {
    if (options.method === 'POST') {
      return Promise.resolve(jsonResponse({ saved: true }))
    }

    getCallCount += 1
    if (getCallCount === 1) {
      return new Promise((resolve) => {
        resolveOldRequest = resolve
      })
    }
    return Promise.resolve(jsonResponse({ version: 'fresh' }))
  })

  const { apiGet, apiPost } = await import('../src/api/client')
  const oldGet = apiGet('/api/posts', { dedupe: false })

  await apiPost('/api/admin/posts', { title: 'updated' }, { invalidatePaths: ['/api/posts'] })

  const freshGet = apiGet('/api/posts')
  await expect(freshGet).resolves.toEqual({ version: 'fresh' })
  expect(getCallCount).toBe(2)

  resolveOldRequest(jsonResponse({ version: 'stale' }))
  await expect(oldGet).resolves.toEqual({ version: 'stale' })

  await expect(apiGet('/api/posts')).resolves.toEqual({ version: 'fresh' })
  expect(getCallCount).toBe(2)
})

/**
 * `includeResponseMeta` exists because `GET /api/admin/images` returns a bare JSON array and
 * carries its continuation token in the `X-Next-Cursor` response header. Callers that do not
 * ask for it must keep receiving the parsed body unchanged — every other call site depends on
 * that, and the fetch mocks around this suite deliberately expose no `headers.entries()`.
 */
it('returns a {data, headers} envelope only when includeResponseMeta is set', async () => {
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'X-Next-Cursor': 'cur-2' }),
    json: () => Promise.resolve([{ filename: 'a.png' }]),
    text: () => Promise.resolve('[]'),
  }))

  const { apiGet } = await import('../src/api/client')

  const envelope = await apiGet('/api/admin/images?limit=60', { auth: true, includeResponseMeta: true })
  expect(envelope.data).toEqual([{ filename: 'a.png' }])
  // Header names are lowercased by the fetch spec, and the value must survive as a plain
  // object so the envelope stays JSON-serializable for the session cache.
  expect(envelope.headers['x-next-cursor']).toBe('cur-2')

  const bare = await apiGet('/api/admin/images?limit=60&cursor=cur-2', { auth: true })
  expect(bare).toEqual([{ filename: 'a.png' }])
})
