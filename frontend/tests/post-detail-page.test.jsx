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

it('renders post detail', async () => {
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

it('shows not found message on404', async () => {
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
