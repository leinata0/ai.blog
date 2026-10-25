import { act, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import usePublicCollection from '../src/hooks/usePublicCollection'
import ContentTypePage from '../src/pages/ContentTypePage'
import { COLLECTION_REFRESH_TIMEOUT_MS, readCollectionBootstrap, saveCollectionSnapshot } from '../src/utils/collectionBootstrap'
import { createCollectionSnapshot } from '../src/utils/publicCollectionSnapshot'
import { fetchDiscover } from '../src/api/posts'

vi.mock('../src/api/posts', () => ({ fetchDiscover: vi.fn(), fetchPosts: vi.fn() }))
vi.mock('../src/components/Navbar', () => ({ default: ({ children }) => <header>{children}</header> }))
vi.mock('../src/components/Footer', () => ({ default: () => null }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))

const story = { slug: 'published-report', title: '可直接阅读的真实报道', content_type: 'daily_brief', created_at: '2026-07-25T08:00:00Z' }
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }
beforeEach(() => {
  sessionStorage.clear()
  delete window.__BLOG_COLLECTION_BOOTSTRAP__
  delete window.__BLOG_COLLECTION_BOOTSTRAPS__
  document.documentElement.dataset.newsStyle = 'tech'
  localStorage.setItem('news-style', 'tech')
})
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks()
  delete window.__BLOG_COLLECTION_BOOTSTRAP__; delete window.__BLOG_COLLECTION_BOOTSTRAPS__
})

function seedOldBundle() {
  const generatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [story], generatedAt) }
  return generatedAt
}

it('renders the real daily headline immediately from an aged homepage bundle while the API is still pending', async () => {
  seedOldBundle()
  const pending = deferred()
  fetchDiscover.mockReturnValue(pending.promise)
  render(<MemoryRouter initialEntries={['/daily']}><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 1, name: story.title })).toBeInTheDocument()
  expect(screen.queryByText('正在载入日报…')).not.toBeInTheDocument()
  expect(screen.getByText(/正在核对更新，暂显/)).toBeInTheDocument()
  await act(async () => pending.resolve({ items: [] }))
  expect(screen.queryByRole('heading', { level: 1, name: story.title })).not.toBeInTheDocument()
  expect(screen.getByText('AI 日报 暂时还没有内容')).toBeInTheDocument()
})

it('limits an expired preview to eight seconds even if a loader ignores cancellation, and ignores its late result', async () => {
  vi.useFakeTimers()
  seedOldBundle()
  const pending = deferred()
  const load = vi.fn(() => pending.promise)
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load }))
  expect(result.current.preview).toBe(true)
  expect(result.current.items[0].slug).toBe(story.slug)
  const signal = load.mock.calls[0][0].signal
  await act(async () => vi.advanceTimersByTime(COLLECTION_REFRESH_TIMEOUT_MS))
  expect(signal.aborted).toBe(true)
  expect(result.current.preview).toBe(false)
  expect(result.current.loading).toBe(false)
  expect(result.current.items).toEqual([])
  expect(result.current.error).toContain('请重试')
  await act(async () => pending.resolve([story]))
  expect(result.current.items).toEqual([])
})

it('stops displaying an unverified preview as soon as verification fails', async () => {
  seedOldBundle()
  const pending = deferred()
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load: () => pending.promise }))
  await act(async () => pending.reject(new Error('连接暂时失败')))
  expect(result.current.items).toEqual([])
  expect(result.current.error).toBe('连接暂时失败')
  expect(result.current.preview).toBe(false)
})

it('does not revive either build object after a newer successful withdrawal, including an expired empty session result', () => {
  seedOldBundle()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = window.__BLOG_COLLECTION_BOOTSTRAPS__['/daily']
  const now = Date.now()
  saveCollectionSnapshot('/daily', [], now)
  expect(readCollectionBootstrap('/daily', now + 6 * 60 * 1000, { allowPreview: true })).toBeNull()
  sessionStorage.clear()
  expect(readCollectionBootstrap('/daily', now, { allowPreview: true })).toBeNull()
})

it('keeps the original generatedAt when a CDN snapshot arrives instead of renewing its freshness', async () => {
  const generatedAt = new Date(Date.now() - 60000).toISOString()
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load: async () => createCollectionSnapshot('/daily', [story], generatedAt) }))
  await act(async () => { await Promise.resolve() })
  expect(result.current.generatedAt).toBe(generatedAt)
  expect(result.current.expiresAt).toBe(Date.parse(generatedAt) + 5 * 60 * 1000)
})

it('never publishes an older nonempty CDN response after this page has observed a newer empty result', async () => {
  vi.useFakeTimers()
  seedOldBundle()
  const now = Date.now()
  const load = vi.fn().mockResolvedValueOnce(createCollectionSnapshot('/daily', [], new Date(now).toISOString()))
    .mockResolvedValueOnce(createCollectionSnapshot('/daily', [story], new Date(now - 60000).toISOString()))
  const { result } = renderHook(() => usePublicCollection({ route: '/daily', load }))
  await act(async () => { await Promise.resolve() })
  expect(result.current.items).toEqual([])
  await act(async () => vi.advanceTimersByTime(1500))
  await act(async () => window.dispatchEvent(new Event('focus')))
  expect(load).toHaveBeenCalledTimes(2)
  expect(result.current.items).toEqual([])
  expect(result.current.generatedAt).toBe(new Date(now).toISOString())
})
