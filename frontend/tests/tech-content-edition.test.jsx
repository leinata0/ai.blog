import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

it('uses the real latest daily story as the scene and keeps a chronological news index', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(await screen.findByRole('heading', { level: 1, name: '最新报道的真实标题' })).toBeInTheDocument()
  const scene = screen.getByRole('region', { name: '日报焦点报道' })
  expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/latest')
  expect(scene.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
  expect(scene).toHaveTextContent('覆盖 2026-07-25')
  expect(scene).toHaveTextContent('3 个原始来源')
  expect(scene).toHaveTextContent('16 分钟阅读')
  const index = screen.getByRole('region', { name: /^新闻档案\s*03$/ })
  expect(within(index).getAllByRole('heading', { level: 3 }).map((node) => node.textContent)).toEqual(['最新报道的真实标题', '中间日期报道', '早期报道'])
  expect([...index.querySelectorAll('time')].map((node) => node.getAttribute('datetime'))).toEqual(['2026-07-26T08:00:00Z', '2026-07-23T08:00:00Z', '2026-06-20T08:00:00Z'])
  expect(screen.getByRole('searchbox', { name: '搜索已载入报道' })).toBeInTheDocument()
  expect(container.querySelector('.news-section__lead')).toBeNull()
  expect(screen.queryByText(/每日更新|今日 AI|LIVE SIGNAL/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /订阅 AI 日报 RSS/ }).getAttribute('href')).toContain('/api/feeds/daily.xml')
  expect(screen.getByRole('link', { name: /订阅这个栏目/ })).toHaveAttribute('href', '/feeds?content_type=daily_brief')
  expect(api.fetchDiscover).toHaveBeenCalledWith({ content_type: 'daily_brief', sections: 'items,total' }, expect.objectContaining({ signal: expect.any(AbortSignal), dedupe: false }))
})

it('prioritizes the actual daily hero cover and lazy-loads the linked index covers', async () => {
  render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  const scene = await screen.findByRole('region', { name: '日报焦点报道' })
  const heroImage = scene.querySelector('.issue-scene-images img')
  expect(heroImage).toHaveAttribute('src', 'https://img.563118077.xyz/news.jpg')
  expect(heroImage).toHaveAttribute('loading', 'eager')
  expect(heroImage).toHaveAttribute('fetchpriority', 'high')
  const index = screen.getByRole('region', { name: /^新闻档案\s*03$/ })
  const previousCover = within(index).getByRole('link', { name: '阅读：中间日期报道' })
  expect(previousCover).toHaveAttribute('href', '/posts/middle')
  expect(previousCover.querySelector('img')).toHaveAttribute('src', 'https://img.563118077.xyz/middle.jpg')
  expect(previousCover.querySelector('img')).toHaveAttribute('loading', 'lazy')
  expect(previousCover.querySelector('img')).not.toHaveAttribute('fetchpriority', 'high')
  expect(within(index).getByRole('link', { name: '阅读全文：最新报道的真实标题' })).toHaveAttribute('href', '/posts/latest')
})

it('keeps daily titles, publication dates and reading routes when latest and older covers fail', async () => {
  render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  const scene = await screen.findByRole('region', { name: '日报焦点报道' })
  const index = screen.getByRole('region', { name: /^新闻档案\s*03$/ })
  const previousCover = within(index).getByRole('link', { name: '阅读：中间日期报道' })
  fireEvent.error(scene.querySelector('.issue-scene-images img'))
  fireEvent.error(previousCover.querySelector('img'))
  expect(scene.querySelector('.issue-scene-images img')).toBeNull()
  expect(scene.querySelector('.issue-image-fallback')).toHaveTextContent('本报道封面暂不可用')
  expect(within(previousCover).getByText('封面暂不可用')).toBeInTheDocument()
  expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/latest')
  expect(previousCover).toHaveAttribute('href', '/posts/middle')
  expect(within(scene).getByRole('heading', { level: 1, name: '最新报道的真实标题' })).toBeInTheDocument()
  const previous = within(index).getByRole('heading', { level: 3, name: '中间日期报道' })
  expect(previous.querySelector('a')).toHaveAttribute('href', '/posts/middle')
  expect(previous.closest('li').querySelector('time')).toHaveAttribute('datetime', '2026-07-23T08:00:00Z')
  expect(scene.querySelector('time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
})

it('keeps latest and previous daily reports navigable when no cover was published', async () => {
  api.fetchDiscover.mockResolvedValueOnce({ items: postsFor('daily_brief').map((post) => ({ ...post, cover_image: '' })) })
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  const scene = await screen.findByRole('region', { name: '日报焦点报道' })
  expect(scene.querySelector('.issue-image-fallback')).toHaveTextContent('本报道暂无封面')
  expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/latest')
  const index = screen.getByRole('region', { name: /^新闻档案\s*03$/ })
  for (const [title, slug] of [['中间日期报道', 'middle'], ['早期报道', 'older']]) {
    const cover = within(index).getByRole('link', { name: `阅读：${title}` })
    expect(cover).toHaveAttribute('href', `/posts/${slug}`)
    expect(within(cover).getByText('文字报道')).toBeInTheDocument()
    expect(within(index).getByRole('link', { name: `阅读全文：${title}` })).toHaveAttribute('href', `/posts/${slug}`)
  }
  expect(container.querySelectorAll('img')).toHaveLength(0)
  expect(within(scene).getByRole('heading', { level: 1, name: '最新报道的真实标题' })).toBeInTheDocument()
  expect(within(index).getByRole('heading', { level: 3, name: '中间日期报道' })).toBeInTheDocument()
})

it('keeps a one-report daily edition readable without inventing metadata or extra scenes', async () => {
  api.fetchDiscover.mockResolvedValueOnce({ items: [{ slug: 'only/report', title: '仅一篇日报' }] })
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  const scene = await screen.findByRole('region', { name: '日报焦点报道' })
  expect(within(scene).getByRole('heading', { level: 1, name: '仅一篇日报' })).toBeInTheDocument()
  expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/only%2Freport')
  expect(scene.querySelector('.issue-story-meta')).toHaveTextContent('发布日期未提供')
  expect(scene.querySelector('.issue-story-meta time')).toBeNull()
  expect(scene.querySelector('.issue-story-meta')).not.toHaveTextContent(/0 个|0 分钟|覆盖/)
  expect(within(scene).getAllByRole('button', { name: /^切换焦点：/ })).toHaveLength(1)
  expect(within(scene).queryByRole('button', { name: '下一条焦点报道' })).not.toBeInTheDocument()
  expect(within(scene).queryByRole('button', { name: '上一条焦点报道' })).not.toBeInTheDocument()
  expect(scene).not.toHaveClass('issue-reel--scroll')
  expect(scene.querySelector('.issue-focus-order')).toHaveTextContent('01 — 01')
  const index = screen.getByRole('region', { name: /^新闻档案\s*01$/ })
  expect(within(index).getByRole('link', { name: '阅读全文：仅一篇日报' })).toHaveAttribute('href', '/posts/only%2Freport')
  expect(container.querySelectorAll('img')).toHaveLength(0)
})

it('allows both reports in a two-report edition to become the focus with matching read destinations', async () => {
  api.fetchDiscover.mockResolvedValueOnce({ items: postsFor('daily_brief').slice(1) })
  render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  const scene = await screen.findByRole('region', { name: '日报焦点报道' })
  expect(scene).not.toHaveClass('issue-reel--scroll')
  expect(within(scene).getAllByRole('button', { name: /^切换焦点：/ })).toHaveLength(2)
  fireEvent.click(within(scene).getByRole('button', { name: '下一条焦点报道' }))
  await waitFor(() => {
    expect(within(scene).getByRole('heading', { level: 1, name: '中间日期报道' })).toBeInTheDocument()
    expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/middle')
    expect(scene.querySelector('.issue-scene-images img')).toHaveAttribute('src', 'https://img.563118077.xyz/middle.jpg')
  })
  expect(scene.querySelector('.issue-story-meta time')).toHaveAttribute('datetime', '2026-07-23T08:00:00Z')
  expect(scene.querySelector('.issue-focus-order')).toHaveTextContent('02 — 02')
  fireEvent.click(within(scene).getByRole('button', { name: '下一条焦点报道' }))
  expect(within(scene).getByRole('heading', { level: 1, name: '最新报道的真实标题' })).toBeInTheDocument()
  expect(within(scene).getByRole('link', { name: /阅读报道/ })).toHaveAttribute('href', '/posts/latest')
})

it('gives the live daily route its canonical, feed and structured data without the Demo noindex policy', async () => {
  const staleRobots = document.createElement('meta')
  staleRobots.name = 'robots'
  staleRobots.content = 'noindex,follow'
  document.head.appendChild(staleRobots)
  render(<MemoryRouter initialEntries={['/daily']}><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 1, name: '最新报道的真实标题' })
  expect(document.title).toBe('AI 日报 - AI 资讯观察')
  expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.563118077.xyz/daily')
  expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  expect(document.head.querySelector('meta[property="og:image"]')).toHaveAttribute('content', 'https://img.563118077.xyz/news.jpg')
  expect(document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]')?.getAttribute('href')).toContain('/api/feeds/daily.xml')
  const collection = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent)).find((entry) => entry['@type'] === 'CollectionPage')
  expect(collection).toMatchObject({ '@type': 'CollectionPage', name: 'AI 日报' })
  expect(collection.url).toMatch(/\/daily$/)
})

it('uses actual cover art in a cinematic weekly showcase and a searchable issue library', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })
  expect(screen.getByRole('heading', { level: 1, name: 'AI 周报' })).toBeInTheDocument()
  const cover = container.querySelector('.cweekly-cover-stage')
  expect(screen.getByRole('link', { name: '阅读这一期：最新报道的真实标题' })).toHaveAttribute('href', '/posts/latest')
  expect(cover.querySelector('img')).toHaveAttribute('src', 'https://img.563118077.xyz/news.jpg')
  expect(container.querySelector('.cweekly-editorial time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
  expect([...container.querySelectorAll('.cweekly-library-issue h3')].map((node) => node.textContent)).toEqual(['最新报道的真实标题', '中间日期报道', '早期报道'])
  expect(container.querySelector('.tech-content-timeline')).toBeNull()
  expect(container.querySelector('.tech-content-date-index')).toBeNull()
  expect(screen.getByRole('searchbox', { name: '搜索已载入周报' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /订阅 AI 周报 RSS/ }).getAttribute('href')).toContain('/api/feeds/weekly.xml')
})

it('keeps the weekly cover link and the real publication metadata when the image fails', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="weekly_review" /></MemoryRouter>)
  await screen.findByRole('heading', { level: 2, name: '最新报道的真实标题' })
  const cover = container.querySelector('.cweekly-cover-stage')
  fireEvent.error(cover.querySelector('img'))
  expect(within(cover).getByText('封面暂不可用')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '阅读这一期：最新报道的真实标题' })).toHaveAttribute('href', '/posts/latest')
  expect(screen.getByRole('heading', { level: 2, name: '最新报道的真实标题' })).toBeInTheDocument()
  expect(container.querySelector('.cweekly-editorial time')).toHaveAttribute('datetime', '2026-07-26T08:00:00Z')
})

it('distinguishes an unavailable feed from an empty edition and recovers through retry', async () => {
  api.fetchDiscover.mockRejectedValue(new Error('503'))
  api.fetchPosts.mockRejectedValue(new Error('503'))
  render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('栏目暂时无法加载，请稍后重试。')
  expect(screen.queryByRole('region', { name: '日报焦点报道' })).not.toBeInTheDocument()
  expect(screen.queryByRole('searchbox', { name: '搜索已载入报道' })).not.toBeInTheDocument()
  expect(screen.queryByText('AI 日报 暂时还没有内容')).not.toBeInTheDocument()
  api.fetchDiscover.mockResolvedValue({ items: [] })
  fireEvent.click(screen.getByRole('button', { name: /重新加载栏目/ }))
  expect(await screen.findByText('AI 日报 暂时还没有内容')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: '日报焦点报道' })).not.toBeInTheDocument()
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

it('keeps the header readable after a direct jump past the hero and restores its overlay on return', async () => {
  const { container } = render(<MemoryRouter><ContentTypePage contentType="daily_brief" /></MemoryRouter>)
  await screen.findByRole('region', { name: '日报焦点报道' })
  const edition = container.querySelector('.issue-live')
  const boundary = container.querySelector('main > div[aria-hidden="true"]')
  let top = 1200
  const measure = vi.spyOn(boundary, 'getBoundingClientRect').mockImplementation(() => ({ top }))
  try {
    fireEvent.scroll(window)
    await waitFor(() => expect(edition).not.toHaveClass('issue-paper-header'))
    // Jump over the entire hero in one step; the one-pixel marker never enters
    // the viewport, so an intersection-only implementation misses this change.
    top = -1800
    fireEvent.scroll(window)
    await waitFor(() => expect(edition).toHaveClass('issue-paper-header'))
    top = 1200
    fireEvent.resize(window)
    await waitFor(() => expect(edition).not.toHaveClass('issue-paper-header'))
  } finally {
    measure.mockRestore()
  }
})
