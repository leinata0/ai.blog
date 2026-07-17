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
