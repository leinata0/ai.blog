import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import usePublicCollection from '../src/hooks/usePublicCollection'
import { COLLECTION_CACHE_PREFIX, COLLECTION_SESSION_MAX_AGE_MS, saveCollectionSnapshot } from '../src/utils/collectionBootstrap'
import { createCollectionSnapshot } from '../src/utils/publicCollectionSnapshot'

const story = { slug: 'existing', title: 'Already available', content_type: 'daily_brief' }
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(() => { sessionStorage.clear(); delete window.__BLOG_COLLECTION_BOOTSTRAP__ })
afterEach(() => { vi.useRealTimers(); delete window.__BLOG_COLLECTION_BOOTSTRAP__ })

it('shows build data synchronously without awaiting the real background request', async () => {
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [story])
  const pending = deferred()
  const load = vi.fn(() => pending.promise)
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load, errorMessage: 'Failed' }))
  expect(result.current.items[0].slug).toBe('existing')
  expect(result.current.loading).toBe(false)
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  expect(load.mock.calls[0][0]).toEqual(expect.objectContaining({ cache: false, forceRefresh: true, staleWhileRevalidate: false, dedupe: false }))
  await act(async () => pending.resolve([{ ...story, slug: 'latest' }]))
  expect(result.current.items[0].slug).toBe('latest')
})

it('retains valid cached content on refresh failure and retry requests fresh data', async () => {
  saveCollectionSnapshot('/daily', [story])
  const load = vi.fn().mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce([])
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load, errorMessage: 'Failed' }))
  await waitFor(() => expect(result.current.refreshError).toBe('Failed'))
  expect(result.current.error).toBe('')
  expect(result.current.items[0].slug).toBe('existing')
  act(() => result.current.retry())
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(result.current.items).toEqual([]))
  expect(result.current.refreshError).toBe('')
  expect(JSON.parse(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).items).toEqual([])
})

it('does not keep stale cached content indefinitely when refresh fails', async () => {
  vi.useFakeTimers()
  saveCollectionSnapshot('/daily', [story])
  const load = vi.fn().mockRejectedValue(new Error('Offline'))
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load, errorMessage: 'Failed' }))
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(result.current.items).toHaveLength(1)
  await act(async () => vi.advanceTimersByTime(COLLECTION_SESSION_MAX_AGE_MS))
  expect(result.current.items).toEqual([])
  expect(result.current.error).toBe('Failed')
})

it('aborts route changes, ignores late responses, and restores the returning route cache', async () => {
  const daily = deferred(), weekly = deferred()
  const loadDaily = vi.fn(() => daily.promise), loadWeekly = vi.fn(() => weekly.promise)
  const { result, rerender } = renderHook(({ route }) => usePublicCollection({ route, load: route === '/daily' ? loadDaily : loadWeekly, errorMessage: 'Failed' }), { initialProps: { route: '/daily' } })
  await waitFor(() => expect(loadDaily).toHaveBeenCalledTimes(1))
  const signal = loadDaily.mock.calls[0][0].signal
  rerender({ route: '/weekly' })
  expect(signal.aborted).toBe(true)
  await act(async () => daily.resolve([story]))
  expect(result.current.items).toEqual([])
  await act(async () => weekly.resolve([{ ...story, slug: 'weekly', content_type: 'weekly_review' }]))
  expect(result.current.items[0].slug).toBe('weekly')
  saveCollectionSnapshot('/daily', [story])
  loadDaily.mockReturnValue(new Promise(() => {}))
  rerender({ route: '/daily' })
  expect(result.current.items[0].slug).toBe('existing')
  expect(result.current.loading).toBe(false)
})
