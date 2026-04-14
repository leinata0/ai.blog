import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import { proxyImageUrl } from '../src/utils/proxyImage'
import PostDetailPage from '../src/pages/PostDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: vi.fn((slug) => {
    if (slug === 'missing') {
      return Promise.reject(new Error('HTTP 404'))
    }
    return Promise.resolve({
      title: 'Python automation with Selenium and Pandas',
      slug: 'python-automation-selenium-pandas',
      summary: 'Mock summary describing Selenium and Pandas automation.',
      content_md: `# Python automation with Selenium and Pandas

Combining Selenium flows with Pandas cleansed data enables quick automation scripts.

![Example image](https://example.com/markdown.jpg)
`,
      tags: [{ name: 'Python', slug: 'python' }],
      source_summary: 'This article combines an official source with two independent commentaries.',
      sources: [
        { source_name: 'OpenAI Blog', source_url: 'https://example.com/openai' },
      ],
      same_series_posts: [
        { title: 'Another daily brief', slug: 'another-daily-brief', created_at: '2026-04-14T08:00:00Z' },
      ],
      same_topic_posts: [
        { title: 'Topic follow-up', slug: 'topic-follow-up', created_at: '2026-04-13T08:00:00Z' },
      ],
      same_week_posts: [
        { title: 'Weekly context', slug: 'weekly-context', created_at: '2026-04-12T08:00:00Z', content_type: 'weekly_review' },
      ],
    })
  }),
  likePost: vi.fn(() => Promise.resolve({})),
  fetchRelatedPosts: vi.fn(() => Promise.resolve([])),
  fetchComments: vi.fn(() => Promise.resolve([])),
  postComment: vi.fn(() => Promise.resolve({})),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders post detail and additional discovery rails', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <PostDetailPage slug="python-automation-selenium-pandas" />
      </ThemeProvider>
    </MemoryRouter>
  )
  const headings = await screen.findAllByRole('heading', { name: /python automation/i })
  expect(headings.length).toBeGreaterThan(0)
  expect(container.querySelector('[data-ui="detail-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="detail-article"]')).toBeTruthy()
  expect(await screen.findByText(/来源摘要/i)).toBeInTheDocument()
  expect(await screen.findByText(/同系列继续阅读/i)).toBeInTheDocument()
  expect(await screen.findByText(/同主题相关文章/i)).toBeInTheDocument()
  expect(await screen.findByText(/同周上下文/i)).toBeInTheDocument()
})

it('renders markdown images with proxy and lazy loading', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <PostDetailPage slug="python-automation-selenium-pandas" />
      </ThemeProvider>
    </MemoryRouter>
  )

  const articleImage = await screen.findByRole('img', { name: 'Example image' })
  expect(articleImage).toBeInTheDocument()
  expect(articleImage).toHaveAttribute('loading', 'lazy')
  expect(articleImage).toHaveAttribute('src', proxyImageUrl('https://example.com/markdown.jpg'))
})

it('shows not found message on 404', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <PostDetailPage slug="missing" />
      </ThemeProvider>
    </MemoryRouter>
  )

  await waitFor(() => {
    expect(container.querySelector('[data-ui="detail-error"]')).toBeTruthy()
  })
  expect(container.querySelector('[data-ui="detail-error"]')?.textContent?.length).toBeGreaterThan(0)
})
