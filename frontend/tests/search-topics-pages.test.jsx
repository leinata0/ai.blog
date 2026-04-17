import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import SearchPage from '../src/pages/SearchPage'
import TopicDetailPage from '../src/pages/TopicDetailPage'

vi.mock('../src/api/posts', () => ({
  fetchSearch: vi.fn(() => Promise.resolve({
    items: [
      {
        title: 'OpenAI New Model Brief',
        slug: 'openai-new-model-brief',
        summary: 'Summary',
        content_type: 'daily_brief',
        topic_key: 'openai-new-model',
        coverage_date: '2026-04-15',
        quality_score: 88,
        reading_time: 6,
        created_at: '2026-04-15T10:00:00Z',
      },
    ],
    topics: [{ topic_key: 'openai-new-model', display_title: 'OpenAI New Model', post_count: 3 }],
  })),
  fetchSeriesList: vi.fn(() => Promise.resolve([{ slug: 'ai-daily-brief', title: 'AI Daily Brief' }])),
  fetchTopics: vi.fn(() => Promise.resolve({
    items: [{ topic_key: 'openai-new-model', display_title: 'OpenAI New Model', post_count: 3 }],
  })),
  fetchTopicDetail: vi.fn(() => Promise.resolve({
    topic_key: 'openai-new-model',
    display_title: 'OpenAI New Model',
    description: 'Track the OpenAI new model release rhythm.',
    posts: [
      {
        title: 'OpenAI New Model Brief',
        slug: 'openai-new-model-brief',
        summary: 'Summary',
        content_type: 'daily_brief',
        created_at: '2026-04-15T10:00:00Z',
      },
    ],
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

it('renders search results after submit', async () => {
  render(
    <MemoryRouter initialEntries={['/search']}>
      <ThemeProvider>
        <SearchPage />
      </ThemeProvider>
    </MemoryRouter>
  )

  await userEvent.type(screen.getByPlaceholderText(/OpenAI/i), 'openai')
  await userEvent.click(screen.getByRole('button', { name: /开始搜索/i }))

  expect((await screen.findAllByText('OpenAI New Model Brief')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('OpenAI New Model').length).toBeGreaterThan(0)
  expect(screen.getByText(/保存当前搜索方向的订阅偏好/i)).toBeInTheDocument()
  expect(screen.getByText(/追踪这个主题/i)).toBeInTheDocument()
})

it('renders topic detail page with rss subscription link', async () => {
  render(
    <MemoryRouter initialEntries={['/topics/openai-new-model']}>
      <ThemeProvider>
        <Routes>
          <Route path="/topics/:topicKey" element={<TopicDetailPage />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByRole('heading', { name: 'OpenAI New Model' })).toBeInTheDocument()
  expect((await screen.findAllByText('OpenAI New Model Brief')).length).toBeGreaterThan(0)
  expect(await screen.findByText(/这条主线最近更新了什么/i)).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: /订阅这个主题的 RSS/i })
  ).toHaveAttribute('href', '/api/feeds/topics/openai-new-model.xml')
})
