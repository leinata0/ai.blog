import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/utils/performanceTrial', () => ({ PERFORMANCE_TRIAL_ENABLED: false }))
import usePublicCollection from '../src/hooks/usePublicCollection'
import { readCollectionBootstrap, saveCollectionSnapshot } from '../src/utils/collectionBootstrap'
import { createCollectionSnapshot } from '../src/utils/publicCollectionSnapshot'

beforeEach(() => sessionStorage.clear())
afterEach(() => { vi.useRealTimers(); delete window.__BLOG_COLLECTION_BOOTSTRAP__ })

it('disables build/session seeding and keeps legacy request options when the trial is off', async () => {
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/topics', [{ topic_key: 'old' }])
  expect(readCollectionBootstrap('/topics')).toBeNull()
  expect(saveCollectionSnapshot('/topics', [{ topic_key: 'old' }])).toBeNull()
  let resolve
  const load = vi.fn(() => new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => usePublicCollection({ route: '/topics', load, errorMessage: 'Failed', legacyOptions: { staleWhileRevalidate: true, cacheTtl: 30000 } }))
  expect(result.current.loading).toBe(true)
  expect(result.current.items).toEqual([])
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
  expect(load.mock.calls[0][0]).toEqual({ signal: expect.any(AbortSignal), staleWhileRevalidate: true, cacheTtl: 30000 })
  await act(async () => resolve([{ topic_key: 'fresh' }]))
  expect(result.current.items).toEqual([{ topic_key: 'fresh' }])
  expect(sessionStorage.length).toBe(0)
  vi.useFakeTimers()
  await act(async () => { vi.advanceTimersByTime(6 * 60 * 1000); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  expect(load).toHaveBeenCalledTimes(1)
})
