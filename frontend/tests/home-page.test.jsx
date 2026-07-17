import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { SiteProvider } from '../src/contexts/SiteContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { fetchHomeBootstrap } from '../src/api/home'
import { fetchPosts } from '../src/api/posts'
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
    if (path === '/api/stats') return Promise.resolve({ post_count: 3, tag_count: 2, series_count: 4 })
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
  prefetchPostDetail: vi.fn(),
}))

vi.mock('../src/api/home', () => ({
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

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete window.__BLOG_BOOTSTRAP__
})

afterEach(cleanup)

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
  expect(screen.getByRole('textbox', { name: '搜索文章' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '继续阅读今天与本周的更新' })).toBeInTheDocument()
  expect(container.querySelector('[data-ui="filter-bar"]')).toBeTruthy()
  expect(screen.getByRole('complementary')).toBeInTheDocument()
  expect(screen.getByText('作者与站点')).toBeInTheDocument()
  expect(container.querySelector('[data-ui="home-weekly-spotlight"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-daily-rail"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-series-showcase"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-topic-pulse"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-continue-reading"]')).toBeNull()
  expect(container.querySelector('[data-ui="home-subscription-shortcut"]')).toBeNull()
  expect(await screen.findAllByText(/Python automation with Selenium and Pandas/i)).not.toHaveLength(0)
  expect(fetchHomeBootstrap).toHaveBeenCalledTimes(1)
  expect(fetchPosts).not.toHaveBeenCalled()

  await userEvent.click(within(document.querySelector('[data-ui="filter-bar"]')).getByRole('button', { name: /Python/i }))
  await waitFor(() => expect(fetchPosts).toHaveBeenCalledTimes(1))
  expect((await screen.findAllByText(/Python automation with Selenium and Pandas/i)).length).toBeGreaterThan(0)
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

  await screen.findAllByText(/Python automation with Selenium and Pandas/i)
  await userEvent.type(screen.getByRole('textbox', { name: '搜索文章' }), 'Python')
  await userEvent.click(screen.getByRole('button', { name: '开始搜索' }))
  await waitFor(() => expect(fetchPosts).toHaveBeenCalledTimes(1))

  await userEvent.click(screen.getByRole('button', { name: '清空' }))
  expect(await screen.findByText('Newest unfiltered article')).toBeInTheDocument()
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

  await waitFor(() => expect(screen.queryByText('Stale filtered response')).not.toBeInTheDocument())
  expect(screen.getByText('Newest unfiltered article')).toBeInTheDocument()
})
