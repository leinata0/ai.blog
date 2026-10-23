import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import { SiteProvider } from '../src/contexts/SiteContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { fetchHomeBootstrap, fetchHomeModules } from '../src/api/home'
import { fetchPosts } from '../src/api/posts'
import HomePage from '../src/pages/HomePage'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

vi.mock('../src/api/client', () => ({
  apiGet: vi.fn((path) => {
    if (path === '/api/settings') {
      return Promise.resolve({
        author_name: 'Test',
        bio: '',
        avatar_url: '',
        hero_image: '',
        github_link: '',
        announcement: '',
        site_url: '',
        friend_links: '[]',
      })
    }
    if (path === '/api/stats') return Promise.resolve({ post_count: 3, tag_count: 2, series_count: 4 })
    return Promise.resolve({})
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/posts', () => ({
  fetchTopics: vi.fn(() => Promise.resolve({ items: [] })),
  fetchPosts: vi.fn(({ tag } = {}) => {
    const allPosts = [
      {
        title: 'Python automation with Selenium and Pandas',
        slug: 'python-automation-selenium-pandas',
        summary: 'Automation workflow with Selenium and Pandas.',
        content_type: 'daily_brief',
        tags: [
          { name: 'Python', slug: 'python' },
          { name: 'Automation', slug: 'automation' },
        ],
      },
      {
        title: 'Weekly review of model launches',
        slug: 'weekly-review-model-launches',
        summary: 'A weekly review card.',
        content_type: 'weekly_review',
        tags: [{ name: 'Weekly', slug: 'weekly' }],
      },
      {
        title: 'OpenClaw deployment guide',
        slug: 'openclaw-deployment-guide',
        summary: 'Deployment notes and debugging tips.',
        content_type: 'daily_brief',
        tags: [
          { name: 'DevOps', slug: 'devops' },
          { name: 'OpenClaw', slug: 'openclaw' },
        ],
      },
    ]
    const filtered = tag ? allPosts.filter((post) => post.tags.some((item) => item.slug === tag)) : allPosts
    return Promise.resolve({ items: filtered, total: filtered.length, page: 1, page_size: 10 })
  }),
  prefetchPostDetail: vi.fn(),
}))

vi.mock('../src/api/home', () => ({
  fetchHomeModules: vi.fn(() => Promise.resolve({ latest_weekly: [], featured_series: [] })),
  fetchHomeBootstrap: vi.fn(() => Promise.resolve({
    settings: {
      author_name: 'Bootstrap Test',
      bio: '',
      avatar_url: '',
      hero_image: '',
      github_link: '',
      announcement: '',
      site_url: 'https://www.563118077.xyz',

      friend_links: '[]',
    },
    posts: {
      items: [
        {
          title: 'Python automation with Selenium and Pandas',
          slug: 'python-automation-selenium-pandas',
          summary: 'Automation workflow with Selenium and Pandas.',
          content_type: 'daily_brief',
          tags: [
            { name: 'Python', slug: 'python' },
            { name: 'Automation', slug: 'automation' },
          ],
        },
        {
          title: 'Weekly review of model launches',
          slug: 'weekly-review-model-launches',
          summary: 'A weekly review card.',
          content_type: 'weekly_review',
          tags: [{ name: 'Weekly', slug: 'weekly' }],
        },
        {
          title: 'OpenClaw deployment guide',
          slug: 'openclaw-deployment-guide',
          summary: 'Deployment notes and debugging tips.',
          content_type: 'daily_brief',
          tags: [
            { name: 'DevOps', slug: 'devops' },
            { name: 'OpenClaw', slug: 'openclaw' },
          ],
        },
      ],
      total: 3,
      page: 1,
      page_size: 10,
    },
  })),
}))

const defaultFetchPosts = fetchPosts.getMockImplementation()

beforeEach(() => {
  vi.clearAllMocks()
  fetchPosts.mockReset().mockImplementation(defaultFetchPosts)
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete window.__BLOG_BOOTSTRAP__
})

afterEach(cleanup)

it('renders a news front page with topic filtering and quick preview', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <SiteProvider>
          <HomePage />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByRole('heading', { name: 'AI 新闻与观察' })).toBeInTheDocument()
  expect(await screen.findByRole('region', { name: '本期头条' })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="news-frontpage"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="today-signal-board"]')).toBeNull()
  expect(screen.getByRole('heading', { name: '焦点报道' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '搜索文章' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '新闻一览' })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(screen.queryByRole('complementary', { name: '新闻速览' })).not.toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: '周报深读' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '让阅读继续。' })).toBeInTheDocument()
  expect(screen.queryByText('作者与站点')).not.toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-weekly-spotlight"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-daily-rail"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-series-showcase"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-topic-pulse"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-continue-reading"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-subscription-shortcut"]')).toBeNull()
  await waitFor(() => {
    expect(screen.queryAllByText(/Python automation with Selenium and Pandas/i)).not.toHaveLength(0)
  }, { timeout: 5000 })
  await userEvent.click(screen.getAllByRole('button', { name: '快速预览' })[0])
  expect(screen.getByRole('dialog', { name: 'Python automation with Selenium and Pandas' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '关闭文章预览' }))
  expect(fetchHomeBootstrap).toHaveBeenCalledTimes(1)
  expect(fetchPosts).not.toHaveBeenCalled()

  await userEvent.click(screen.getByText('按标签筛选', { selector: 'summary' }))
  await userEvent.click(within(document.querySelector('[data-ui="filter-bar"]')).getByRole('button', { name: /Python/i }))
  await waitFor(() => expect(fetchPosts).toHaveBeenCalledTimes(1))
  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
})

it('renders one page title and four native chapter links to mounted sections', async () => {
  const { container } = render(
    <MemoryRouter><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>,
  )
  await screen.findByRole('region', { name: '本期头条' })

  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(screen.getByRole('heading', { level: 1, name: 'AI 新闻与观察' })).toBeInTheDocument()
  const chapterIds = ['edition-focus', 'edition-news', 'edition-topics', 'edition-reading']
  for (const label of ['本期阅读目录', '本期展览目录']) {
    const directory = screen.getByRole('navigation', { name: label })
    const links = within(directory).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(chapterIds.map((id) => `#${id}`))
  }
  for (const id of chapterIds) {
    const targets = container.querySelectorAll(`[id="${id}"]`)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toBeVisible()
  }
})

it('allocates each story to one board and supports the title-only reading mode', async () => {
  const posts = Array.from({ length: 10 }, (_, index) => ({
    slug: `board-${index}`, title: `板块报道 ${index}`, summary: `摘要 ${index}`,
    content_type: index === 0 || index === 4 ? 'weekly_review' : 'daily_brief',
    created_at: '2026-07-26T08:00:00Z', tags: [],
  }))
  fetchHomeBootstrap.mockResolvedValueOnce({ settings: { site_url: 'https://www.563118077.xyz' }, posts: { items: posts, total: 10 } })
  fetchHomeModules.mockResolvedValueOnce({ latest_weekly: [posts[0], posts[4], { ...posts[4], slug: 'older-week', title: '历史周报' }], featured_series: [] })
  const { container } = render(<MemoryRouter><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)
  await waitFor(() => expect(container.querySelectorAll('article[data-story-slug]')).toHaveLength(11))
  const slugs = [...container.querySelectorAll('article[data-story-slug]')].map((node) => node.dataset.storySlug)
  expect(new Set(slugs).size).toBe(slugs.length)
  const deepReads = screen.getByRole('complementary', { name: '周报深读' })
  expect(within(deepReads).getByRole('heading', { name: '板块报道 4' })).toBeInTheDocument()
  expect(within(deepReads).queryByRole('heading', { name: '板块报道 0' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: '文章列表' })).queryByRole('heading', { name: '板块报道 4' })).not.toBeInTheDocument()
  const control = screen.getByRole('group', { name: '新闻显示方式' })
  await userEvent.click(within(control).getByRole('button', { name: '标题', exact: true }))
  expect(within(control).getByRole('button', { name: '标题', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(container.querySelector('.news-feed')).toHaveAttribute('data-density', 'titles')
  expect(container.querySelectorAll('article[data-story-slug]')).toHaveLength(11)
})

it('keeps lead stories readable when supplementary modules fail, then retries independently', async () => {
  fetchHomeModules.mockRejectedValueOnce(new Error('Module unavailable'))
  render(<MemoryRouter><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Python automation with Selenium and Pandas' })
  expect(await screen.findByText('周报与专栏暂时无法加载，请稍后重试。')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: '本期头条' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '重试深读' }))
  await waitFor(() => expect(screen.queryByText('周报与专栏暂时无法加载，请稍后重试。')).not.toBeInTheDocument())
  expect(fetchHomeModules).toHaveBeenCalledTimes(2)
  expect(fetchPosts).not.toHaveBeenCalled()
})

it('replaces the exhibition hero and chapter directory with the paper front page on style switch', async () => {
  render(<MemoryRouter><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)
  await screen.findByRole('region', { name: '本期头条' })
  expect(screen.getByRole('region', { name: '智能新纪元视觉专刊' })).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: '本期展览目录' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '菜单', exact: true }))
  await userEvent.click(screen.getByRole('button', { name: '报刊版', exact: true }))

  expect(screen.queryByRole('region', { name: '智能新纪元视觉专刊' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '本期阅读目录' })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: '本期展览目录' })).not.toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  const frontPage = screen.getByRole('region', { name: '本期头条' })
  expect(within(frontPage).getByRole('heading', { name: 'Python automation with Selenium and Pandas' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: '搜索文章' })).toBeInTheDocument()
})

it('does not let a stale filtered request overwrite the restored latest-post view', async () => {
  let resolveFilteredRequest
  fetchPosts
    .mockImplementationOnce(() => new Promise((resolve) => {
      resolveFilteredRequest = resolve
    }))
    .mockResolvedValueOnce({
      items: [{
        title: 'Newest unfiltered article',
        slug: 'newest-unfiltered-article',
        summary: 'Fresh homepage content.',
        content_type: 'post',
        tags: [{ name: 'Fresh', slug: 'fresh' }],
      }],
      total: 1,
      page: 1,
      page_size: 10,
    })

  render(
    <MemoryRouter>
      <ThemeProvider>
        <SiteProvider>
          <HomePage />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => {
    expect(screen.queryAllByText(/Python automation with Selenium and Pandas/i)).not.toHaveLength(0)
  }, { timeout: 5000 })
  await userEvent.type(screen.getByRole('textbox', { name: '搜索文章' }), 'Python')
  await userEvent.click(screen.getByRole('button', { name: '搜索新闻' }))
  await waitFor(() => expect(fetchPosts).toHaveBeenCalledTimes(1))

  await userEvent.click(screen.getByRole('button', { name: '清空' }))
  expect((await screen.findAllByText('Newest unfiltered article')).length).toBeGreaterThan(0)
  expect(fetchPosts.mock.calls[1][0]).toEqual(expect.objectContaining({ page: 1, tag: undefined, q: undefined }))

  resolveFilteredRequest({
    items: [{
      title: 'Stale filtered response',
      slug: 'stale-filtered-response',
      summary: 'This response arrived too late.',
      content_type: 'post',
      tags: [{ name: 'Python', slug: 'python' }],
    }],
    total: 1,
    page: 1,
    page_size: 10,
  })

  await waitFor(() => expect(screen.queryAllByText('Stale filtered response')).toHaveLength(0))
  expect(screen.getAllByText('Newest unfiltered article').length).toBeGreaterThan(0)
})

it('does not present old search results as homepage headlines after a failed reset', async () => {
  fetchPosts.mockResolvedValue({
    items: [{ slug: 'filtered-only', title: '只属于搜索结果的文章', created_at: '2026-07-20T08:00:00Z', tags: [] }],
    total: 1,
  })
  render(<MemoryRouter initialEntries={['/?q=Python']}><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)
  await screen.findByRole('heading', { name: '只属于搜索结果的文章' })
  fetchPosts.mockRejectedValue(new Error('Home unavailable'))
  await userEvent.click(screen.getByRole('button', { name: '清空', exact: true }))
  await screen.findByText('暂时无法加载文章列表，请稍后再试。')
  const focus = screen.getByRole('region', { name: '本期头条' })
  expect(within(focus).queryByRole('heading', { name: '只属于搜索结果的文章' })).not.toBeInTheDocument()
  expect(within(focus).queryByText('2026/07/20')).not.toBeInTheDocument()
  expect(within(focus).getByText('日期暂不可用')).toBeInTheDocument()
})

it('hydrates tag and pagination state from the URL', async () => {
  render(
    <MemoryRouter initialEntries={['/?tag=python&page=2']}>
      <ThemeProvider>
        <SiteProvider>
          <HomePage />
          <LocationProbe />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(fetchPosts).toHaveBeenCalledWith(
    expect.objectContaining({ tag: 'python', page: 2 }),
    expect.any(Object),
  ))
  expect(screen.getByTestId('location')).toHaveTextContent('tag=python&page=2')
})

it('shows actual publication dates and source counts without claiming historical news is live', async () => {
  fetchHomeBootstrap.mockResolvedValueOnce({
    settings: { site_url: 'https://www.563118077.xyz' },
    posts: { items: [{
      slug: 'dated-headline', title: '一条有日期的头条', summary: '有真实来源的历史报道。',
      created_at: '2026-07-26T08:00:00Z', updated_at: '2026-10-22T08:00:00Z',
      source_count: 3, content_type: 'daily_brief', tags: [],
    }], total: 1, page: 1, page_size: 10 },
  })
  render(<MemoryRouter><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)

  await screen.findByRole('heading', { name: '一条有日期的头条' })
  const frontPage = screen.getByRole('region', { name: '本期头条' })
  const headline = within(frontPage).getByRole('article')
  expect(within(headline).getByText('3 个来源')).toBeInTheDocument()
  expect(within(headline).getByText('2026/07/26')).toHaveAttribute('dateTime', '2026-07-26T08:00:00.000Z')
  expect(screen.queryByText(/2026\/10\/22|LIVE SIGNAL|今日 AI|人工核实/)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /打开订阅中心/ })).toHaveAttribute('href', '/feeds')
})

it('distinguishes unavailable news metrics from a successfully loaded empty result', async () => {
  fetchPosts.mockReset().mockRejectedValue(new Error('Unavailable'))
  render(<MemoryRouter initialEntries={['/?q=missing']}><ThemeProvider><SiteProvider><HomePage /></SiteProvider></ThemeProvider></MemoryRouter>)
  await screen.findByText('暂时无法加载文章列表，请稍后再试。')
  const status = screen.getByRole('group', { name: '新闻档案状态' })
  expect(within(status).getByText('—')).toBeInTheDocument()
  expect(await within(status).findByText('暂不可用')).toBeInTheDocument()
  expect(within(status).queryByText('0')).not.toBeInTheDocument()

  fetchPosts.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  await userEvent.click(screen.getByRole('button', { name: /重试加载/ }))
  await screen.findByRole('heading', { name: '暂时没有匹配的资讯' })
  expect(within(status).getByText('0')).toBeInTheDocument()
  expect(within(status).getByText('暂无日期')).toBeInTheDocument()
})
