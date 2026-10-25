import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useNewsroomData from '../src/hooks/useNewsroomData'
import { fetchHomeModules } from '../src/api/home'
import { fetchTopics } from '../src/api/posts'

vi.mock('../src/api/home', () => ({ fetchHomeModules: vi.fn() }))
vi.mock('../src/api/posts', () => ({ fetchTopics: vi.fn() }))

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  fetchHomeModules.mockResolvedValue({ latest_weekly: [], featured_series: [] })
  fetchTopics.mockResolvedValue({ items: [] })
})
afterEach(cleanup)

it('does not request supplementary content while disabled', () => {
  const { result } = renderHook(() => useNewsroomData(false, {}))
  expect(fetchHomeModules).not.toHaveBeenCalled()
  expect(fetchTopics).not.toHaveBeenCalled()
  expect(result.current).toMatchObject({ modules: null, topics: null, loading: false, error: '', modulesError: '' })
})

it('starts both requests in parallel and publishes either success before the other finishes', async () => {
  const modules = deferred(), topics = deferred()
  fetchHomeModules.mockReturnValue(modules.promise)
  fetchTopics.mockReturnValue(topics.promise)
  const { result } = renderHook(() => useNewsroomData(true))
  expect(result.current.loading).toBe(true)
  expect(fetchHomeModules).toHaveBeenCalledWith()
  expect(fetchTopics).toHaveBeenCalledWith({ limit: 4 })

  const content = { latest_weekly: [{ slug: 'weekly' }] }
  await act(async () => modules.resolve(content))
  expect(result.current.modules).toBe(content)
  expect(result.current.loading).toBe(true)
  expect(result.current.topics).toBe(null)

  const items = [{ topic_key: 'models' }]
  await act(async () => topics.resolve({ items }))
  expect(result.current.topics).toBe(items)
  expect(result.current.loading).toBe(false)
})

it('shows usable bootstrap immediately, accepts late bootstrap and revalidates once despite new empty objects', async () => {
  const modules = deferred(), topics = deferred()
  fetchHomeModules.mockReturnValue(modules.promise)
  fetchTopics.mockReturnValue(topics.promise)
  const { result, rerender } = renderHook(({ bootstrap }) => useNewsroomData(true, bootstrap), {
    initialProps: { bootstrap: {} },
  })
  expect(result.current.modules).toBe(null)
  const bootstrap = { featured_series: [{ slug: 'series' }] }
  rerender({ bootstrap })
  expect(result.current.modules).toBe(bootstrap)
  rerender({ bootstrap: {} })
  rerender({ bootstrap: { latest_weekly: [], featured_series: [] } })
  expect(result.current.modules).toBe(bootstrap)
  expect(fetchHomeModules).toHaveBeenCalledTimes(1)
  expect(fetchTopics).toHaveBeenCalledTimes(1)
  const fresh = { latest_weekly: [{ slug: 'new-weekly' }] }
  await act(async () => { modules.resolve(fresh); topics.resolve({ items: [] }) })
  expect(result.current.modules).toBe(fresh)
})

it('shows topic seeds immediately without restarting revalidation when the seed changes or becomes empty', async () => {
  const modules = deferred(), topics = deferred()
  fetchHomeModules.mockReturnValue(modules.promise)
  fetchTopics.mockReturnValue(topics.promise)
  const seed = [{ topic_key: 'initial' }]
  const { result, rerender } = renderHook(({ bootstrap }) => useNewsroomData(true, {}, bootstrap), {
    initialProps: { bootstrap: seed },
  })
  expect(result.current.topics).toBe(seed)
  expect(result.current.loading).toBe(true)
  const changedSeed = [{ topic_key: 'updated' }]
  rerender({ bootstrap: changedSeed })
  expect(result.current.topics).toBe(changedSeed)
  rerender({ bootstrap: [] })
  rerender({ bootstrap: undefined })
  expect(result.current.topics).toBe(changedSeed)
  expect(fetchHomeModules).toHaveBeenCalledTimes(1)
  expect(fetchTopics).toHaveBeenCalledTimes(1)

  const fresh = [{ topic_key: 'revalidated' }]
  await act(async () => { modules.resolve({}); topics.resolve({ items: fresh }) })
  expect(result.current.topics).toBe(fresh)
  rerender({ bootstrap: seed })
  expect(result.current.topics).toBe(fresh)
})

it('retains topic seed on request failure, accepts a late seed and lets a successful empty result replace it', async () => {
  fetchTopics.mockRejectedValueOnce(new Error('offline'))
  const { result, rerender } = renderHook(({ bootstrap }) => useNewsroomData(true, {}, bootstrap), {
    initialProps: { bootstrap: [] },
  })
  expect(result.current.topics).toBe(null)
  const seed = [{ topic_key: 'from-ssg' }]
  rerender({ bootstrap: seed })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.topics).toBe(seed)
  expect(result.current.error).toContain('追踪专题')
  expect(fetchTopics).toHaveBeenCalledTimes(1)
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.topics).toEqual([])
  expect(result.current.error).toBe('')
  expect(fetchTopics).toHaveBeenCalledTimes(2)
})

it('retains a successful partial response and represents failed data as unknown until retry succeeds', async () => {
  const modules = { latest_weekly: [{ slug: 'weekly' }] }
  fetchHomeModules.mockResolvedValue(modules)
  fetchTopics.mockRejectedValueOnce(new Error('offline'))
  const { result } = renderHook(() => useNewsroomData(true, {}))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.modules).toBe(modules)
  expect(result.current.topics).toBe(null)
  expect(result.current.error).toContain('追踪专题')
  expect(result.current.modulesError).toBe('')

  const retryTopics = deferred()
  fetchHomeModules.mockRejectedValueOnce(new Error('temporarily unavailable'))
  fetchTopics.mockReturnValueOnce(retryTopics.promise)
  act(() => result.current.retry())
  expect(result.current.loading).toBe(true)
  expect(result.current.modules).toBe(modules)
  await act(async () => retryTopics.resolve({ items: [{ topic_key: 'open-source' }] }))
  expect(result.current.modules).toBe(modules)
  expect(result.current.topics).toEqual([{ topic_key: 'open-source' }])
  expect(result.current.error).toContain('周报与专栏')
  expect(result.current.modulesError).toContain('周报与专栏')

  act(() => result.current.retry())
  expect(result.current.modulesError).toBe('')
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toBe('')
  expect(result.current.modulesError).toBe('')
  expect(result.current.topics).toEqual([])
  expect(fetchHomeModules).toHaveBeenCalledTimes(3)
})

it('preserves bootstrap after both requests fail and reports both failures', async () => {
  const bootstrap = { latest_weekly: [{ slug: 'known-weekly' }] }
  fetchHomeModules.mockRejectedValue(new Error('modules offline'))
  fetchTopics.mockRejectedValue(new Error('topics offline'))
  const { result } = renderHook(() => useNewsroomData(true, bootstrap))
  expect(result.current.modules).toBe(bootstrap)
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.modules).toBe(bootstrap)
  expect(result.current.topics).toBe(null)
  expect(result.current.error).toContain('周报与专栏、追踪专题')
})

it('ignores pending responses after disabling and starts a fresh consumer when enabled again', async () => {
  const oldModules = deferred(), oldTopics = deferred()
  fetchHomeModules.mockReturnValueOnce(oldModules.promise)
  fetchTopics.mockReturnValueOnce(oldTopics.promise)
  const { result, rerender } = renderHook(({ enabled }) => useNewsroomData(enabled), {
    initialProps: { enabled: true },
  })
  rerender({ enabled: false })
  expect(result.current.loading).toBe(false)
  await act(async () => { oldModules.resolve({ latest_weekly: [{ slug: 'old' }] }); oldTopics.resolve({ items: [{ topic_key: 'old' }] }) })
  expect(result.current.modules).toBe(null)
  expect(result.current.topics).toBe(null)

  rerender({ enabled: true })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.modules).toEqual({ latest_weekly: [], featured_series: [] })
  expect(result.current.topics).toEqual([])
  expect(fetchHomeModules).toHaveBeenCalledTimes(2)
})

it('ignores a superseded request even when it resolves after the retry', async () => {
  const oldModules = deferred(), oldTopics = deferred()
  fetchHomeModules.mockReturnValueOnce(oldModules.promise)
  fetchTopics.mockReturnValueOnce(oldTopics.promise)
  const { result } = renderHook(() => useNewsroomData(true))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(async () => { oldModules.resolve({ latest_weekly: [{ slug: 'old' }] }); oldTopics.reject(new Error('old error')) })
  expect(result.current.modules).toEqual({ latest_weekly: [], featured_series: [] })
  expect(result.current.topics).toEqual([])
  expect(result.current.error).toBe('')
})

it('does not publish any pending results after unmount', async () => {
  const modules = deferred(), topics = deferred()
  fetchHomeModules.mockReturnValue(modules.promise)
  fetchTopics.mockReturnValue(topics.promise)
  const { result, unmount } = renderHook(() => useNewsroomData(true))
  const beforeUnmount = result.current
  unmount()
  await act(async () => { modules.resolve({ latest_weekly: [] }); topics.reject(new Error('offline')) })
  expect(result.current).toBe(beforeUnmount)
})

it('uses complete managed homepage data without launching duplicate module or topic requests', () => {
  const modules = { latest_weekly: [{ slug: 'weekly' }], featured_series: [] }
  const topics = [{ topic_key: 'models' }]
  const retry = vi.fn()
  const { result } = renderHook(() => useNewsroomData(true, modules, topics, { managed: true, loading: false, retry }))
  expect(result.current.modules).toBe(modules)
  expect(result.current.topics).toBe(topics)
  expect(result.current.loading).toBe(false)
  result.current.retry()
  expect(retry).toHaveBeenCalledOnce()
  expect(fetchHomeModules).not.toHaveBeenCalled()
  expect(fetchTopics).not.toHaveBeenCalled()
})

it('lets a managed empty result clear both sections instead of reviving their old nonempty refs', () => {
  const { result, rerender } = renderHook(({ modules, topics }) => useNewsroomData(true, modules, topics, { managed: true }), {
    initialProps: { modules: { latest_weekly: [{ slug: 'withdrawn' }] }, topics: [{ topic_key: 'withdrawn' }] },
  })
  rerender({ modules: { latest_weekly: [], featured_series: [] }, topics: [] })
  expect(result.current.modules.latest_weekly).toEqual([])
  expect(result.current.topics).toEqual([])
  expect(fetchHomeModules).not.toHaveBeenCalled()
  expect(fetchTopics).not.toHaveBeenCalled()
})
