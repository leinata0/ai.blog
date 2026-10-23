import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ fetchDiscover: vi.fn(), fetchPosts: vi.fn() }))
vi.mock('../src/api/posts', () => api)
vi.mock('../src/components/Navbar', () => ({ default: () => <div>Navigation</div> }))
vi.mock('../src/components/Footer', () => ({ default: () => <div>Footer</div> }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))
import ContentTypePage from '../src/pages/ContentTypePage'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.setItem('news-style', 'paper')
  api.fetchPosts.mockResolvedValue({ items: [] })
  api.fetchDiscover.mockResolvedValue({ items: [
    { slug: 'older', title: '早期报道', summary: '早期报道摘要', created_at: '2026-07-20T08:00:00Z', content_type: 'daily_brief' },
    { slug: 'latest', title: '最近报道的真实标题', summary: '来自接口的报道摘要', created_at: '2026-07-26T08:00:00Z', coverage_date: '2026-07-25', source_count: 3, cover_image: 'https://example.com/news.jpg', content_type: 'daily_brief' },
    { slug: 'middle', title: '中间日期报道', summary: '补充背景', created_at: '2026-07-23T08:00:00Z', content_type: 'daily_brief' },
  ] })
})
afterEach(() => { cleanup(); window.localStorage.removeItem('news-style') })

it('presents a dated lead and chronological news rows without implying a current-day update', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: '最近报道的真实标题' })).toBeInTheDocument()
  expect(container.querySelector('.news-section__latest time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
  expect(container.querySelector('.news-section__lead')).toHaveTextContent('覆盖 2026-07-25')
  expect(container.querySelector('.news-section__lead')).toHaveTextContent('3 个来源')
  const rows = [...container.querySelectorAll('.news-section__story h3')].map((node) => node.textContent)
  expect(rows).toEqual(['中间日期报道', '早期报道'])
  expect(screen.queryByText('每日更新')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /最近报道的真实标题/ })).toHaveAttribute('href', '/posts/latest')
  expect(screen.getByRole('link', { name: /订阅 AI 日报 RSS/ }).getAttribute('href')).toContain('/api/feeds/daily.xml')
  expect(screen.getByRole('link', { name: /订阅这个栏目/ })).toHaveAttribute('href', '/feeds?content_type=daily_brief')
  expect(within(screen.getByRole('navigation', { name: '新闻栏目' })).getByRole('link', { name: '日报' })).toHaveAttribute('aria-current', 'page')
})

it('keeps the story link and metadata when a news thumbnail cannot load', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  await screen.findByRole('heading', { name: '最近报道的真实标题' })
  fireEvent.error(container.querySelector('.news-section__lead img'))
  expect(await screen.findByText('配图暂不可用')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /最近报道的真实标题/ })).toHaveAttribute('href', '/posts/latest')
  expect(within(screen.getByRole('navigation', { name: '新闻栏目' })).getByRole('link', { name: '周报' })).toHaveAttribute('aria-current', 'page')
})
