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
      return Promise.resolve({ author_name: 'Test', bio: '', avatar_url: '', hero_image: '', github_link: '', announcement: '', site_url: '', friend_links: '[]' })
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
    { slug: 'ai-daily-brief', title: 'AI Daily Brief', description: 'Daily AI coverage.' },
    { slug: 'ai-weekly-review', title: 'AI Weekly Review', description: 'Weekly long-form review.' },
  ])),
  fetchTopics: vi.fn(() => Promise.resolve({
    items: [
      { topic_key: 'openai-models', display_title: 'OpenAI 模型', description: '追踪 OpenAI 模型节奏', is_featured: true, post_count: 3 },
      { topic_key: 'agent-platforms', display_title: 'Agent 平台', description: '追踪 Agent 产品化', is_featured: false, post_count: 2 },
    ],
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders content product sections and still filters by tag click', async () => {
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
  expect(await screen.findByRole('heading', { name: /极客开发日志/i })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-weekly-spotlight"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-daily-rail"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-series-showcase"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-hot-topics"]')).toBeTruthy()
  expect(await screen.findByText('OpenAI 模型')).toBeInTheDocument()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="post-card"]')).toBeTruthy()

  await userEvent.click(screen.getAllByRole('button', { name: /Python/i })[0])
  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
  expect(screen.queryByText(/Weekly review of model launches/i)).not.toBeInTheDocument()
})
