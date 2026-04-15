import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import SeriesPage from '../src/pages/SeriesPage'
import SeriesDetailPage from '../src/pages/SeriesDetailPage'
import DiscoverPage from '../src/pages/DiscoverPage'

vi.mock('../src/api/posts', () => ({
  fetchSeriesList: vi.fn(() => Promise.resolve([
    { slug: 'ai-daily-brief', title: 'AI Daily Brief', description: 'Daily coverage.', is_featured: true },
    { slug: 'ai-weekly-review', title: 'AI Weekly Review', description: 'Weekly review.', is_featured: true },
    { slug: 'product-strategy-watch', title: 'Product Strategy Watch', description: 'Product strategy.', is_featured: false },
    { slug: 'tooling-workflow', title: 'Tooling Workflow', description: 'Tooling and workflow.', is_featured: false },
  ])),
  fetchSeriesDetail: vi.fn(() => Promise.resolve({
    slug: 'ai-daily-brief',
    title: 'AI Daily Brief',
    description: 'Daily coverage.',
    posts: [
      { slug: 'brief-1', title: 'Daily brief one', summary: 'Summary', created_at: '2026-04-15T08:00:00Z' },
    ],
  })),
  fetchDiscover: vi.fn(() => Promise.resolve({
    items: [
      { slug: 'brief-1', title: 'Daily brief one', summary: 'Summary', content_type: 'daily_brief' },
    ],
    total: 1,
  })),
  fetchSearch: vi.fn(() => Promise.resolve({ items: [], total: 0, topics: [] })),
  fetchPosts: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  fetchTopics: vi.fn(() => Promise.resolve({
    items: [{ topic_key: 'openai-models', display_title: 'OpenAI Models', post_count: 2 }],
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders series list page', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <SeriesPage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect((await screen.findAllByText('AI 日报')).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('AI 周报')).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('产品战略观察')).length).toBeGreaterThan(0)
  expect((await screen.findAllByText('工具与工作流')).length).toBeGreaterThan(0)
  expect(container.querySelector('[data-ui="series-page-showcase"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="series-stack-stage"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="series-stack-tabs"]')).toBeTruthy()
})

it('renders series detail and discover pages', async () => {
  render(
    <MemoryRouter initialEntries={['/series/ai-daily-brief']}>
      <ThemeProvider>
        <Routes>
          <Route path="/series/:slug" element={<SeriesDetailPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByRole('heading', { name: 'AI 日报' })).toBeInTheDocument()

  render(
    <MemoryRouter initialEntries={['/discover']}>
      <ThemeProvider>
        <DiscoverPage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByText('Daily brief one')).toBeInTheDocument()
  expect(await screen.findByText('OpenAI Models')).toBeInTheDocument()
})
