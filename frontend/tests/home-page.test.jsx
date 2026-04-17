import { render, screen, waitFor } from '@testing-library/react'
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
  fetchDiscover: vi.fn(() => Promise.resolve({
    featured_series: [
      { slug: 'ai-daily-brief', title: 'AI Daily Brief', description: 'Daily AI coverage.', is_featured: true },
      { slug: 'ai-weekly-review', title: 'AI Weekly Review', description: 'Weekly long-form review.', is_featured: true },
      { slug: 'product-strategy-watch', title: 'Product Strategy Watch', description: 'Product and company moves.', is_featured: true },
      { slug: 'tooling-workflow', title: 'Tooling Workflow', description: 'Tooling and workflow notes.', is_featured: true },
    ],
    latest_daily: [],
    latest_weekly: [],
  })),
  prefetchPostDetail: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

it('renders the homepage hero as a single poster layout', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <SiteProvider>
          <HomePage />
        </SiteProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByRole('heading', { name: '持续更新 AI 最新动态与关键变化的中文博客' })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-hero-focus"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-hero-stage"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-hero-stage"]')?.getAttribute('data-layout')).toBe('single-poster')
  expect(container.querySelectorAll('[data-ui="home-hero-poster"]')).toHaveLength(1)
  expect(container.querySelector('[data-ui="home-weekly-spotlight"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="home-daily-rail"]')).toBeTruthy()
  await waitFor(() => expect(container.querySelector('[data-ui="home-series-showcase"]')).toBeTruthy())
  expect(container.querySelector('[data-ui="home-hot-topics"]')).toBeFalsy()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(await screen.findAllByText(/Python automation with Selenium and Pandas/i)).not.toHaveLength(0)

  await userEvent.click(screen.getAllByRole('button', { name: /Python/i })[0])
  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
})
