import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import { proxyImageUrl } from '../src/utils/proxyImage'
import PostDetailPage from '../src/pages/PostDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchPostDetail: vi.fn((slug) => {
    if (slug === 'missing') {
      return Promise.reject(new Error('HTTP 404'))
    }
    if (slug === 'legacy') {
      return Promise.resolve({
        title: 'Legacy article',
        slug: 'legacy',
        summary: 'Legacy summary.',
        content_md: '# Legacy\n\nBody only.',
        tags: [],
        same_series_posts: [],
        same_topic_posts: [],
        same_week_posts: [],
      })
    }
    return Promise.resolve({
      title: 'Python automation with Selenium and Pandas',
      slug: 'python-automation-selenium-pandas',
      summary: 'Mock summary describing Selenium and Pandas automation.',
      content_md: `# Python automation with Selenium and Pandas

Combining Selenium flows with Pandas cleansed data enables quick automation scripts.

![Example image](https://example.com/markdown.jpg)
`,
      topic_key: 'topic-follow-up',
      series_slug: 'ai-daily-brief',
      tags: [{ name: 'Python', slug: 'python' }],
      source_summary: 'This article combines an official source with two independent commentaries.',
      sources: [
        { source_name: 'OpenAI Blog', source_url: 'https://example.com/openai', is_primary: true },
      ],
      source_count: 4,
      quality_score: 86,
      reading_time: 7,
      quality_snapshot: {
        overall_score: 86,
        structure_score: 88,
        source_score: 82,
        analysis_score: 84,
        packaging_score: 76,
        resonance_score: 40,
        issues: [],
        strengths: ['complete_structure'],
        notes: 'Quality snapshot generated after a passed gate.',
      },
      quality_insights: {
        has_snapshot: true,
        overall_score: 86,
        structure_score: 88,
        source_score: 82,
        analysis_score: 84,
        source_count: 4,
        reading_time: 7,
        structure_summary: '结构区块较完整，阅读路径清晰。',
        source_summary: '来源覆盖较充分，适合继续沿这条主线扩展。',
        analysis_summary: '正文具备较好的分析展开空间，不只停留在信息罗列。',
        followup_recommended: true,
        followup_summary: '这条主线值得继续追踪，后续可以串联同主题和同系列文章。',
        snapshot_notes: 'Quality snapshot generated after a passed gate.',
      },
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

afterEach(() => {
  cleanup()
})

it('renders post detail, evidence layer, and conversion actions', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <PostDetailPage slug="python-automation-selenium-pandas" />
      </ThemeProvider>
    </MemoryRouter>,
  )

  const headings = await screen.findAllByRole('heading', { name: /python automation/i })
  expect(headings.length).toBeGreaterThan(0)
  expect(container.querySelector('[data-ui="detail-shell"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="detail-article"]')).toBeTruthy()
  expect(await screen.findByText(/来源证据/i)).toBeInTheDocument()
  expect((await screen.findAllByText(/质量洞察/i)).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/值得继续追踪/i).length).toBeGreaterThan(0)
  expect(await screen.findByText(/把这篇文章变成持续追踪的入口/i)).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: /进入主题页/i })).toHaveAttribute('href', '/topics/topic-follow-up')
  expect(await screen.findByRole('link', { name: /订阅相关更新/i })).toHaveAttribute('href', '/feeds?topic_key=topic-follow-up')
  expect(await screen.findByRole('link', { name: /回到系列：AI 日报/i })).toHaveAttribute('href', '/series/ai-daily-brief')
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
    </MemoryRouter>,
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
    </MemoryRouter>,
  )

  await waitFor(() => {
    expect(container.querySelector('[data-ui="detail-error"]')).toBeTruthy()
  })
  expect(container.querySelector('[data-ui="detail-error"]')?.textContent?.length).toBeGreaterThan(0)
})

it('degrades gracefully when legacy posts have no quality insight data', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <PostDetailPage slug="legacy" />
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(await screen.findByText('Legacy article')).toBeInTheDocument()
  expect(screen.queryAllByText(/质量洞察/i)).toHaveLength(0)
})
