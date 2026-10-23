/** @vitest-environment node */

import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRequestScheduler, fetchWithRetry, retryAfterMs } from '../scripts/prerender-fetch.mjs'

const START = Date.UTC(2026, 9, 23, 8)
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const clock = () => Date.now()
const scheduler = (options = {}) => createRequestScheduler({
  concurrency: 2, intervalMs: 0, nowImpl: clock, waitImpl: wait, ...options,
})
const response = (status, retryAfter) => ({
  status,
  headers: new Headers(retryAfter === undefined ? {} : { 'Retry-After': String(retryAfter) }),
  body: { cancel: vi.fn(async () => {}) },
})
const retryOptions = (fetchImpl, queue, options = {}) => ({
  attempts: 3, fetchImpl, scheduler: queue, nowImpl: clock,
  waitImpl: wait, randomImpl: () => 0, ...options,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('parses Retry-After seconds and HTTP dates without inventing delays for invalid values', () => {
  expect(retryAfterMs('12', START)).toBe(12_000)
  expect(retryAfterMs('0', START)).toBe(0)
  expect(retryAfterMs(new Date(START + 15_000).toUTCString(), START)).toBe(15_000)
  expect(retryAfterMs(new Date(START - 1000).toUTCString(), START)).toBe(0)
  expect(retryAfterMs(null, START)).toBeNull()
  expect(retryAfterMs('', START)).toBeNull()
  expect(retryAfterMs('not a date', START)).toBeNull()
  expect(retryAfterMs('-1', START)).toBeNull()
})

it('shares one concurrency and start-rate budget across topic, series and post work', async () => {
  const queue = scheduler({ concurrency: 2, intervalMs: 100 })
  const keys = ['topic:a', 'series:a', 'post:a', 'topic:b', 'series:b', 'post:b']
  const starts = []
  let active = 0
  let peak = 0
  const jobs = keys.map((key) => queue.run(async () => {
    active += 1
    peak = Math.max(peak, active)
    starts.push({ key, time: Date.now() })
    await wait(300)
    active -= 1
    return key
  }))

  await vi.runAllTimersAsync()
  expect(await Promise.all(jobs)).toEqual(keys)
  expect(peak).toBeLessThanOrEqual(2)
  expect(starts).toHaveLength(keys.length)
  for (let index = 1; index < starts.length; index += 1) {
    expect(starts[index].time - starts[index - 1].time).toBeGreaterThanOrEqual(100)
  }
})

it('rechecks a shared pause when a later 503 extends an earlier 429 deadline', async () => {
  const queue = scheduler()
  const attempts = new Map()
  const calls = []
  const fetchMock = vi.fn(async (url) => {
    calls.push({ url, time: Date.now() })
    const count = (attempts.get(url) || 0) + 1
    attempts.set(url, count)
    if (url.endsWith('/a') && count === 1) return response(429, 5)
    if (url.endsWith('/b') && count === 1) {
      await wait(1000)
      return response(503, 10)
    }
    return response(200)
  })
  const jobs = ['a', 'b', 'c'].map((key) =>
    fetchWithRetry(`https://api.example.com/${key}`, {}, retryOptions(fetchMock, queue)))

  await vi.advanceTimersByTimeAsync(0)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(4000)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(5999)
  expect(calls).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1)
  expect((await Promise.all(jobs)).every((result) => result.status === 200)).toBe(true)
  expect(calls).toHaveLength(5)
  expect(calls.slice(2).every(({ time }) => time >= START + 11_000)).toBe(true)
})

it('protects the next URL even when a 429 used the last allowed attempt', async () => {
  const queue = scheduler({ concurrency: 1 })
  const limited = response(429, 5)
  const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValue(response(200))
  const first = fetchWithRetry('https://api.example.com/first', {}, retryOptions(fetchMock, queue, { attempts: 1 }))
    .catch((error) => error)
  await vi.advanceTimersByTimeAsync(0)
  expect(await first).toBeInstanceOf(Error)
  expect(limited.body.cancel).toHaveBeenCalledOnce()

  const next = fetchWithRetry('https://api.example.com/next', {}, retryOptions(fetchMock, queue))
  await vi.advanceTimersByTimeAsync(4999)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect((await next).status).toBe(200)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('waits until an HTTP-date Retry-After before retrying the request', async () => {
  const queue = scheduler({ concurrency: 1 })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(429, new Date(START + 4000).toUTCString()))
    .mockResolvedValue(response(200))
  const result = fetchWithRetry('https://api.example.com/date', {}, retryOptions(fetchMock, queue))
  await vi.advanceTimersByTimeAsync(3999)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect((await result).status).toBe(200)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('uses a conservative fallback for headerless 429s and stops at the attempt budget', async () => {
  const queue = scheduler({ concurrency: 1 })
  const times = []
  const fetchMock = vi.fn(async () => { times.push(Date.now()); return response(429) })
  const result = fetchWithRetry('https://api.example.com/limited', {}, retryOptions(fetchMock, queue))
    .catch((error) => error)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(59_999)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_001)
  expect(await result).toBeInstanceOf(Error)
  expect(fetchMock).toHaveBeenCalledTimes(3)
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(60_000)
  expect(times[2] - times[1]).toBeGreaterThanOrEqual(60_000)
  await vi.advanceTimersByTimeAsync(180_000)
  expect(fetchMock).toHaveBeenCalledTimes(3)
})

it('keeps short backoff for headerless 503s and does not retry deterministic 4xx responses', async () => {
  const queue = scheduler({ concurrency: 1 })
  const times = []
  const fetchMock = vi.fn(async () => {
    times.push(Date.now())
    return response(times.length <= 2 ? 503 : times.length === 3 ? 200 : 404)
  })
  const recovered = fetchWithRetry('https://api.example.com/busy', {}, retryOptions(fetchMock, queue))
  await vi.advanceTimersByTimeAsync(249)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(499)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect((await recovered).status).toBe(200)
  const missing = await fetchWithRetry('https://api.example.com/missing', {}, retryOptions(fetchMock, queue))
  expect(missing.status).toBe(404)
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

it('fails immediately for an excessive server delay and rejects later queue work without more HTTP', async () => {
  const queue = scheduler({ concurrency: 1 })
  const fetchMock = vi.fn().mockResolvedValue(response(429, 3600))
  const result = fetchWithRetry('https://api.example.com/long-delay', {}, retryOptions(fetchMock, queue))
    .catch((error) => error)
  await vi.advanceTimersByTimeAsync(0)
  expect(await result).toBeInstanceOf(Error)
  const operation = vi.fn()
  await expect(queue.run(operation)).rejects.toBeInstanceOf(Error)
  await expect(fetchWithRetry('https://api.example.com/later', {}, retryOptions(fetchMock, queue)))
    .rejects.toBeInstanceOf(Error)
  expect(operation).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledOnce()
})

it('counts only added cooldown time and stops repeated short pauses at the shared build budget', async () => {
  const queue = scheduler()
  // Concurrent limited responses describe one shared minute, not eight minutes.
  for (let index = 0; index < 8; index += 1) queue.pause(60_000)
  for (let window = 1; window < 5; window += 1) {
    await vi.advanceTimersByTimeAsync(60_000)
    queue.pause(60_000)
  }
  await vi.advanceTimersByTimeAsync(60_000)
  expect(() => queue.pause(60_000)).toThrow()
  const operation = vi.fn()
  await expect(queue.run(operation)).rejects.toBeInstanceOf(Error)
  expect(operation).not.toHaveBeenCalled()
})

it('does not reject a valid five-minute Retry-After because of its own positive jitter', async () => {
  const queue = scheduler({ concurrency: 1 })
  const fetchMock = vi.fn().mockResolvedValueOnce(response(429, 300)).mockResolvedValue(response(200))
  const result = fetchWithRetry('https://api.example.com/boundary', {}, retryOptions(fetchMock, queue, {
    randomImpl: () => .999,
  }))
  await vi.advanceTimersByTimeAsync(299_999)
  expect(fetchMock).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(1001)
  expect((await result).status).toBe(200)
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
