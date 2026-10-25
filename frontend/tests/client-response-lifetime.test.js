import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/api/auth', () => ({ getToken: () => null, clearToken: () => {} }))
vi.mock('../src/api/userAuth', () => ({ getUserToken: () => null, clearUserToken: () => {} }))
vi.mock('../src/api/base', () => ({ resolveApiBase: () => '', buildApiUrl: (path) => path }))

let apiGet

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Headers settle immediately, while the body deliberately ignores AbortSignal.
// This reproduces a stalled download without making timeout correctness depend
// on the mock implementing fetch's cancellation behavior for us.
function delayedResponse(kind) {
  const body = deferred()
  const reader = vi.fn(() => body.promise)
  const response = {
    ok: kind !== 'error',
    status: kind === 'error' ? 503 : 200,
    headers: new Headers({ 'content-type': kind === 'text' ? 'text/plain' : 'application/json' }),
    json: kind === 'json' ? reader : vi.fn(),
    text: kind === 'json' ? vi.fn() : reader,
  }
  return { body, reader, response }
}

const outcome = (promise) => promise.then((value) => ({ value }), (error) => ({ error }))
const requestOptions = { cache: false, dedupe: false, timeout: 1000 }

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  window.sessionStorage.clear()
  ;({ apiGet } = await import('../src/api/client'))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe.each(['json', 'text', 'error'])('response lifetime: %s body', (kind) => {
  it('times out after headers even when the stalled reader ignores abort', async () => {
    const { response, reader, body } = delayedResponse(kind)
    const fetchSpy = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchSpy)
    const result = outcome(apiGet('/api/discover', requestOptions))

    await vi.advanceTimersByTimeAsync(0)
    expect(reader).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect((await result).error).toMatchObject({ name: 'AbortError', message: '请求超时，请稍后重试' })
    expect(fetchSpy.mock.calls[0][1].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    // A late body failure must remain observed instead of becoming unhandled.
    body.reject(new Error('late body failure'))
    await vi.advanceTimersByTimeAsync(0)
  })

  it('honors caller cancellation while the response body is still pending', async () => {
    const { response, reader, body } = delayedResponse(kind)
    const controller = new AbortController()
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
    const fetchSpy = vi.fn().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchSpy)
    const result = outcome(apiGet('/api/discover', { ...requestOptions, signal: controller.signal }))

    await vi.advanceTimersByTimeAsync(0)
    expect(reader).toHaveBeenCalledOnce()
    controller.abort()

    expect((await result).error).toMatchObject({ name: 'AbortError', message: '请求已取消' })
    expect(fetchSpy.mock.calls[0][1].signal.aborted).toBe(true)
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    body.resolve(kind === 'json' ? { late: true } : 'late body')
    await vi.advanceTimersByTimeAsync(0)
  })
})

it('cleans the deadline and caller listener only after the normal body finishes', async () => {
  const { response, reader, body } = delayedResponse('json')
  const controller = new AbortController()
  const removeListener = vi.spyOn(controller.signal, 'removeEventListener')
  const fetchSpy = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchSpy)
  const request = apiGet('/api/discover', { ...requestOptions, signal: controller.signal, includeResponseMeta: true })

  await vi.advanceTimersByTimeAsync(0)
  expect(reader).toHaveBeenCalledOnce()
  expect(removeListener).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(1)

  body.resolve({ items: [] })
  await expect(request).resolves.toEqual({ data: { items: [] }, headers: { 'content-type': 'application/json' } })
  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
  expect(vi.getTimerCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(1000)
  controller.abort()
  expect(fetchSpy.mock.calls[0][1].signal.aborted).toBe(false)
})

it('keeps the timeout bounded when fetch itself ignores abort', async () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  const result = outcome(apiGet('/api/discover', requestOptions))
  await vi.advanceTimersByTimeAsync(1000)
  expect((await result).error).toMatchObject({ name: 'AbortError', message: '请求超时，请稍后重试' })
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start fetch for an already cancelled caller', async () => {
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  const controller = new AbortController()
  controller.abort()
  await expect(apiGet('/api/discover', { ...requestOptions, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError', message: '请求已取消' })
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves a completed error body and clears its deadline', async () => {
  const { response, body } = delayedResponse('error')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  const result = outcome(apiGet('/api/discover', requestOptions))
  await vi.advanceTimersByTimeAsync(0)
  body.resolve(JSON.stringify({ detail: 'try later', request_id: 'request-1' }))
  expect((await result).error.message).toBe('try later（Request ID: request-1）')
  expect(vi.getTimerCount()).toBe(0)
})

it('never caches a response body that resolves after its request timed out', async () => {
  const { response, body } = delayedResponse('json')
  const fetchSpy = vi.fn().mockResolvedValueOnce(response).mockResolvedValue({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ version: 'fresh' }),
  })
  vi.stubGlobal('fetch', fetchSpy)
  const result = outcome(apiGet('/api/discover', { ...requestOptions, cache: true }))
  await vi.advanceTimersByTimeAsync(1000)
  expect((await result).error.name).toBe('AbortError')
  body.resolve({ version: 'expired' })
  await vi.advanceTimersByTimeAsync(0)
  await expect(apiGet('/api/discover', { ...requestOptions, cache: true })).resolves.toEqual({ version: 'fresh' })
  expect(fetchSpy).toHaveBeenCalledTimes(2)
})

it('forwards explicit credentials without changing the default fetch policy', async () => {
  const fetchSpy = vi.fn().mockImplementation(async () => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ items: [] }),
  }))
  vi.stubGlobal('fetch', fetchSpy)

  await apiGet('/api/discover', { ...requestOptions, credentials: 'omit' })
  expect(fetchSpy.mock.calls[0][1].credentials).toBe('omit')
  await apiGet('/api/settings', requestOptions)
  expect(fetchSpy.mock.calls[1][1]).not.toHaveProperty('credentials')
})
