import { act, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, it, vi } from 'vitest'
import HomePage from '../src/pages/HomePage'

const mocks = vi.hoisted(() => ({ site: {}, fetchPosts: vi.fn(), fetchHomeModules: vi.fn(), fetchTopics: vi.fn() }))
vi.mock('../src/contexts/SiteContext', () => ({ useSite: () => mocks.site }))
vi.mock('../src/api/posts', () => ({ fetchPosts: mocks.fetchPosts, fetchTopics: mocks.fetchTopics, prefetchPostDetail: vi.fn() }))
vi.mock('../src/api/home', () => ({ fetchHomeModules: mocks.fetchHomeModules }))
vi.mock('../src/components/Navbar', () => ({ default: () => null }))
vi.mock('../src/components/Footer', () => ({ default: () => null }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))
vi.mock('../src/components/news/EditionHero', () => ({ default: () => <h1>首页动态场景</h1> }))
vi.mock('../src/components/news/EditionChapterNav', () => ({ default: () => null }))
vi.mock('../src/hooks/useEditionChoreography', () => ({ default: () => {} }))

const post = (slug, title, content_type = 'daily_brief') => ({ slug, title, content_type, tags: [], created_at: '2026-07-25T08:00:00Z' })
const snapshot = () => ({
  posts: { items: [post('lead', '首页已有的头条'), post('second', '第二条头条'), post('third', '第三条头条'), post('stream', '首页已有的新闻流')], total: 141 },
  home_modules: { latest_weekly: [post('weekly', '首页已有的周报', 'weekly_review')], featured_series: [{ slug: 'series', title: '首页已有的系列', post_count: 10 }] },
  home_topics: [{ topic_key: 'models', title: '首页已有的主题', post_count: 5 }],
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('news-style', 'tech')
  mocks.site = { homeDataManaged: true, bootstrap: snapshot(), loading: true, bootstrapLoading: false, retryHomeBootstrap: vi.fn() }
  mocks.fetchPosts.mockResolvedValue({ items: [], total: 0 })
  mocks.fetchHomeModules.mockResolvedValue({})
  mocks.fetchTopics.mockResolvedValue({ items: [] })
})

it('shows the actual news stream, weekly and collections immediately without waiting for settings or duplicate requests', () => {
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: '首页已有的新闻流' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '首页已有的周报' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '首页已有的主题' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '首页已有的系列' })).toBeInTheDocument()
  expect(screen.queryByText('正在载入主题与系列…')).not.toBeInTheDocument()
  expect(mocks.fetchPosts).not.toHaveBeenCalled()
  expect(mocks.fetchHomeModules).not.toHaveBeenCalled()
  expect(mocks.fetchTopics).not.toHaveBeenCalled()
})

it('publishes authoritative empty homepage content without keeping the previous stream or collections', () => {
  const { rerender } = render(<MemoryRouter><HomePage /></MemoryRouter>)
  mocks.site = { ...mocks.site, bootstrap: { posts: { items: [], total: 0 }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] } }
  rerender(<MemoryRouter><HomePage /></MemoryRouter>)
  expect(screen.queryByRole('heading', { name: '首页已有的新闻流' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '首页已有的周报' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '首页已有的主题' })).not.toBeInTheDocument()
  expect(screen.getByText('暂时没有匹配的资讯')).toBeInTheDocument()
})

it('ends a managed homepage failure without starting a serial settings/posts fallback and retries the home request', async () => {
  mocks.site = { ...mocks.site, bootstrap: null, bootstrapLoading: false, bootstrapError: '首页更新超时，请重试。' }
  render(<MemoryRouter><HomePage /></MemoryRouter>)
  const feed = screen.getByRole('region', { name: '文章列表' })
  expect(feed).toHaveAttribute('aria-busy', 'false')
  expect(within(feed).getByRole('alert')).toHaveTextContent('首页更新超时')
  await act(async () => within(feed).getByRole('button', { name: /重试加载/ }).click())
  expect(mocks.site.retryHomeBootstrap).toHaveBeenCalledOnce()
  expect(mocks.fetchPosts).not.toHaveBeenCalled()
})

it('treats an independent AbortError deadline as a visible query error instead of an endless loading skeleton', async () => {
  mocks.fetchPosts.mockRejectedValueOnce(new DOMException('Request timed out', 'AbortError'))
  render(<MemoryRouter initialEntries={['/?q=slow']}><HomePage /></MemoryRouter>)
  const feed = screen.getByRole('region', { name: '文章列表' })
  await waitFor(() => expect(within(feed).getByRole('alert')).toHaveTextContent('暂时无法加载文章列表'))
  expect(feed).toHaveAttribute('aria-busy', 'false')
  expect(mocks.fetchPosts).toHaveBeenCalledWith(expect.objectContaining({ q: 'slow' }), expect.objectContaining({ timeout: 8000, cache: false }))
  expect(mocks.fetchPosts.mock.calls[0][1].signal.aborted).toBe(false)
})
