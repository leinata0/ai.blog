import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { SiteProvider } from '../src/contexts/SiteContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import HomePage from '../src/pages/HomePage'

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
    if (path === '/api/stats') return Promise.resolve({ post_count: 3, tag_count: 2 })
    return Promise.resolve({})
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/posts', () => ({
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
  fetchSeriesList: vi.fn(() => Promise.resolve([
    { slug: 'ai-daily-brief', title: 'AI Daily Brief', description: 'Daily AI coverage.', is_featured: true },
    { slug: 'ai-weekly-review', title: 'AI Weekly Review', description: 'Weekly long-form review.', is_featured: false },
    { slug: 'product-strategy-watch', title: 'Product Strategy Watch', description: 'Product and company moves.', is_featured: false },
    { slug: 'tooling-workflow', title: 'Tooling Workflow', description: 'Tooling and workflow notes.', is_featured: false },
  ])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.localStorage.setItem('blog.followed_topics', JSON.stringify([
    {
      topic_key: 'openai-models',
      display_title: 'OpenAI 模型',
      followed_at: '2026-04-15T10:00:00.000Z',
    },
  ]))
  window.localStorage.setItem('blog.reading_history', JSON.stringify([
    {
      slug: 'python-automation-selenium-pandas',
      title: 'Python automation with Selenium and Pandas',
      topic_key: 'openai-models',
      topic_display_title: 'OpenAI 模型',
      content_type: 'daily_brief',
      visited_at: '2026-04-15T10:30:00.000Z',
    },
  ]))
})

it('keeps the homepage lighter and makes the tracking panel clickable', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <SiteProvider>
          <HomePage />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>
  )

  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
  expect(await screen.findByRole('heading', { name: '持续更新 AI 最新动态与关键变化的中文博客' })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-weekly-spotlight"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-daily-rail"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-series-showcase"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-hot-topics"]')).toBeFalsy()
  expect(screen.queryByRole('heading', { name: '热门主题' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: '继续阅读与关注主题' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '主题' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '打开追踪面板' })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '打开追踪面板' }))
  expect(await screen.findByText('查看追踪页')).toBeInTheDocument()
  expect(await screen.findByText('继续阅读')).toBeInTheDocument()
  expect(await screen.findByText('最近关注')).toBeInTheDocument()
  expect(await screen.findByText('最近浏览')).toBeInTheDocument()
  expect((await screen.findAllByText('OpenAI 模型')).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('Python automation with Selenium and Pandas')).length).toBeGreaterThan(0)

  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="post-card"]')).toBeTruthy()

  await userEvent.click(screen.getAllByRole('button', { name: /Python/i })[0])
  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
  expect(screen.queryByText(/Weekly review of model launches/i)).not.toBeInTheDocument()
})
