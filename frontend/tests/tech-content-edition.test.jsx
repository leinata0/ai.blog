import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ fetchDiscover: vi.fn(), fetchPosts: vi.fn() }))
vi.mock('../src/api/posts', () => api)
vi.mock('../src/components/Navbar', () => ({ default: () => <div>Navigation</div> }))
vi.mock('../src/components/Footer', () => ({ default: () => <div>Footer</div> }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))
import ContentTypePage from '../src/pages/ContentTypePage'

const postsFor = (contentType) => [
  { slug: 'older', title: '早期报道', summary: '早期报道摘要', created_at: '2026-06-20T08:00:00Z', content_type: contentType },
  { slug: 'latest', title: '最新报道的真实标题', summary: '来自接口的报道摘要。', created_at: '2026-07-26T08:00:00Z', coverage_date: '2026-07-25', source_count: 3, reading_time: 16, cover_image: 'https://img.563118077.xyz/news.jpg', content_type: contentType },
  { slug: 'middle', title: '中间日期报道', summary: '补充背景。', created_at: '2026-07-23T08:00:00Z', cover_image: 'https://img.563118077.xyz/middle.jpg', content_type: contentType },
]

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  api.fetchPosts.mockResolvedValue({ items: [] })
  api.fetchDiscover.mockImplementation(({ content_type }) => Promise.resolve({ items: postsFor(content_type) }))
})
afterEach(cleanup)

it('uses a publication-date index and a chronological signal log for daily editions', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'AI 日报' })).toBeInTheDocument()
  const dateIndex = screen.getByLabelText('日报日期索引')
  expect(dateIndex).toHaveTextContent('2026')
  expect(dateIndex.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
  expect(dateIndex.querySelector('time')).toHaveTextContent('07/26')
  expect(container.querySelector('.tech-content-latest')).toHaveTextContent('覆盖 2026-07-25')
  expect(container.querySelector('.tech-content-latest')).toHaveTextContent('3 个来源')
  expect(container.querySelector('.tech-content-latest')).toHaveTextContent('16 分钟阅读')
  expect([...container.querySelectorAll('.tech-content-log-entry h3')].map((node) => node.textContent)).toEqual(['中间日期报道', '早期报道'])
  expect(container.querySelector('.tech-issue-grid')).toBeNull()
  expect(container.querySelector('.news-section__lead')).toBeNull()
  expect(screen.queryByText(/每日更新|今日 AI|LIVE SIGNAL/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /订阅 AI 日报 RSS/ }).getAttribute('href')).toContain('/api/feeds/daily.xml')
  expect(screen.getByRole('link', { name: /订阅这个栏目/ })).toHaveAttribute('href', '/feeds?content_type=daily_brief')
})

it('uses actual cover art and distinct magazine issues for weekly editions', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })
  expect(screen.getByRole('heading', { level: 1, name: 'AI 周报' })).toBeInTheDocument()
  const cover = screen.getByRole('link', { name: '阅读最新周报：最新报道的真实标题' })
  expect(cover).toHaveAttribute('href', '/posts/latest')
  expect(cover.querySelector('img')).toHaveAttribute('src', 'https://img.563118077.xyz/news.jpg')
  expect(cover.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
  expect([...container.querySelectorAll('.tech-issue h3')].map((node) => node.textContent)).toEqual(['中间日期报道', '早期报道'])
  expect(container.querySelector('.tech-content-timeline')).toBeNull()
  expect(container.querySelector('.tech-content-date-index')).toBeNull()
  expect(within(screen.getByRole('navigation', { name: '新闻栏目' })).getByRole('link', { name: /周报/ })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: /订阅 AI 周报 RSS/ }).getAttribute('href')).toContain('/api/feeds/weekly.xml')
})

it('keeps the weekly cover link and the real publication metadata when the image fails', async () => {
  render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })
  const cover = screen.getByRole('link', { name: '阅读最新周报：最新报道的真实标题' })
  fireEvent.error(cover.querySelector('img'))
  expect(within(cover).getByText('配图暂不可用')).toBeInTheDocument()
  expect(cover).toHaveAttribute('href', '/posts/latest')
  expect(screen.getByRole('heading', { level: 2, name: '最新报道的真实标题' })).toBeInTheDocument()
  expect(cover.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
})

it('distinguishes an unavailable feed from an empty edition and recovers through retry', async () => {
  api.fetchDiscover.mockRejectedValue(new Error('503'))
  api.fetchPosts.mockRejectedValue(new Error('503'))
  render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('栏目暂时无法加载，请稍后重试。')
  expect(screen.getByLabelText('日报日期索引')).toHaveTextContent('日期暂不可用')
  expect(screen.queryByText('AI 日报 暂时还没有内容')).not.toBeInTheDocument()
  api.fetchDiscover.mockResolvedValue({ items: [] })
  fireEvent.click(screen.getByRole('button', { name: /重新加载栏目/ }))
  expect(await screen.findByText('AI 日报 暂时还没有内容')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByLabelText('日报日期索引')).toHaveTextContent('等待新的发布')
})

it('retains the compatible endpoint fallback while selecting only the requested content type', async () => {
  api.fetchDiscover.mockRejectedValue(new Error('404'))
  api.fetchPosts.mockResolvedValue({ items: [...postsFor('daily_brief'), { ...postsFor('weekly_review')[1], slug: 'weekly-only', title: '正确的周报回退' }] })
  render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 2, name: '正确的周报回退' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '最新报道的真实标题' })).not.toBeInTheDocument()
  expect(api.fetchPosts).toHaveBeenCalledWith({ pageSize: 50 }, expect.objectContaining({ dedupe: false }))
})

it('restores the unchanged paper story layout through the existing style preference', async () => {
  window.localStorage.setItem('news-style', 'paper')
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })
  expect(container.querySelector('.news-section__lead')).not.toBeNull()
  expect(container.querySelector('.news-section__masthead')).not.toBeNull()
  expect(container.querySelector('.tech-content-date-index')).toBeNull()
  expect(container.querySelector('.tech-content-timeline')).toBeNull()
})
