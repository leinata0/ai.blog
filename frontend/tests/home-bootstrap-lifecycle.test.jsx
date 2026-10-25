import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useHomeBootstrap from '../src/hooks/useHomeBootstrap'
import { fetchPublicHome } from '../src/api/publicHome'
import { HOME_SESSION_MAX_AGE_MS, saveHomeBootstrap } from '../src/utils/homeBootstrap'
import { createPublicHomeSnapshot } from '../src/utils/publicHomeSnapshot'

vi.mock('../src/api/publicHome', () => ({ fetchPublicHome: vi.fn() }))
const snapshot = (items = [{ slug: 'news', title: 'Actual headline' }], generatedAt = new Date().toISOString()) => createPublicHomeSnapshot({ settings: { author_name: 'Known author' }, posts: { items, total: items.length }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] }, generatedAt)
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })

it('does not fetch on a non-home route and keeps the last verified home snapshot on return', async () => {
  const { result, rerender } = renderHook(({ enabled }) => useHomeBootstrap(enabled), { initialProps: { enabled: false } })
  expect(fetchPublicHome).not.toHaveBeenCalled()
  fetchPublicHome.mockImplementation(async () => saveHomeBootstrap(snapshot()))
  rerender({ enabled: true })
  await act(async () => { await Promise.resolve() })
  expect(result.current.snapshot.posts.items[0].slug).toBe('news')
  rerender({ enabled: false })
  expect(result.current.snapshot.posts.items[0].slug).toBe('news')
  expect(fetchPublicHome).toHaveBeenCalledTimes(1)
  fetchPublicHome.mockImplementation(() => new Promise(() => {}))
  rerender({ enabled: true })
  expect(result.current.snapshot.posts.items[0].slug).toBe('news')
  expect(result.current.loading).toBe(false)
})

it('shows an expired build immediately as a dated preview and stops after eight seconds', async () => {
  window.__BLOG_HOME_BOOTSTRAP__ = snapshot(undefined, new Date(Date.now() - 3600000).toISOString())
  fetchPublicHome.mockImplementation(() => new Promise(() => {}))
  const { result } = renderHook(() => useHomeBootstrap(true))
  expect(result.current.snapshot.posts.items[0].slug).toBe('news')
  expect(result.current.preview).toBe(true)
  const signal = fetchPublicHome.mock.calls[0][0].signal
  await act(async () => vi.advanceTimersByTime(8000))
  expect(signal.aborted).toBe(true)
  expect(result.current.snapshot).toBeNull()
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toContain('请重试')
})

it('ends a missing-snapshot load at eight seconds even when the transport ignores cancellation', async () => {
  const pending = deferred()
  fetchPublicHome.mockReturnValue(pending.promise)
  const { result } = renderHook(() => useHomeBootstrap(true))
  expect(result.current.loading).toBe(true)
  await act(async () => vi.advanceTimersByTime(8000))
  expect(result.current.loading).toBe(false)
  expect(result.current.error).toContain('请重试')
  await act(async () => pending.resolve(saveHomeBootstrap(snapshot())))
  expect(result.current.snapshot).toBeNull()
})

it('clears an unverified preview on failure and does not resurrect it after an authoritative empty response', async () => {
  window.__BLOG_HOME_BOOTSTRAP__ = snapshot(undefined, new Date(Date.now() - 3600000).toISOString())
  fetchPublicHome.mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(() => useHomeBootstrap(true))
  await act(async () => { await Promise.resolve() })
  expect(result.current.snapshot).toBeNull()
  expect(result.current.error).toBe('offline')
  fetchPublicHome.mockImplementation(async () => saveHomeBootstrap(snapshot([])))
  act(() => result.current.retry())
  await act(async () => { await Promise.resolve() })
  expect(result.current.snapshot.posts.items).toEqual([])
  expect(result.current.preview).toBe(false)
  expect(result.current.error).toBe('')
})

it('preserves a valid snapshot on refresh failure only until its original expiry', async () => {
  const stored = saveHomeBootstrap(snapshot())
  fetchPublicHome.mockRejectedValue(new Error('offline'))
  const { result } = renderHook(() => useHomeBootstrap(true))
  await act(async () => { await Promise.resolve() })
  expect(result.current.snapshot.expiresAt).toBe(stored.expiresAt)
  expect(result.current.refreshError).toBe('offline')
  await act(async () => vi.advanceTimersByTime(HOME_SESSION_MAX_AGE_MS))
  expect(result.current.snapshot).toBeNull()
  expect(result.current.loading).toBe(false)
})

it('defers hidden refresh, revalidates on return and coalesces focus/visibility events', async () => {
  let visibility = 'hidden'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  window.__BLOG_HOME_BOOTSTRAP__ = snapshot(undefined, new Date(Date.now() - 3600000).toISOString())
  const pending = deferred()
  fetchPublicHome.mockReturnValue(pending.promise)
  const { result } = renderHook(() => useHomeBootstrap(true))
  expect(fetchPublicHome).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTime(10000))
  visibility = 'visible'
  act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')) })
  expect(fetchPublicHome).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve(saveHomeBootstrap(snapshot([]))))
  expect(result.current.snapshot.posts.items).toEqual([])
})

it('ignores late results after disabling and removes timers and listeners on unmount', async () => {
  const pending = deferred()
  fetchPublicHome.mockReturnValue(pending.promise)
  const { result, rerender, unmount } = renderHook(({ enabled }) => useHomeBootstrap(enabled), { initialProps: { enabled: true } })
  const signal = fetchPublicHome.mock.calls[0][0].signal
  rerender({ enabled: false })
  expect(signal.aborted).toBe(true)
  await act(async () => pending.resolve(saveHomeBootstrap(snapshot())))
  expect(result.current.snapshot).toBeNull()
  unmount()
  await act(async () => { vi.advanceTimersByTime(600000); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  expect(fetchPublicHome).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('dates a formerly fresh snapshot during its bounded expiry verification instead of extending its TTL', async () => {
  const stored = saveHomeBootstrap(snapshot())
  const pending = deferred()
  fetchPublicHome.mockResolvedValueOnce(stored).mockReturnValueOnce(pending.promise)
  const { result } = renderHook(() => useHomeBootstrap(true))
  await act(async () => { await Promise.resolve() })
  await act(async () => vi.advanceTimersByTime(HOME_SESSION_MAX_AGE_MS))
  expect(result.current.preview).toBe(true)
  expect(result.current.generatedAt).toBe(stored.generatedAt)
  expect(result.current.loading).toBe(false)
  await act(async () => vi.advanceTimersByTime(8000))
  expect(result.current.snapshot).toBeNull()
  expect(result.current.error).toContain('请重试')
})
