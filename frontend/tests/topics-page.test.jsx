import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import TopicsPage from '../src/pages/TopicsPage'

vi.mock('../src/api/posts', () => ({
  fetchTopics: vi.fn(() => Promise.resolve({
    items: [
      {
        topic_key: 'openai-models',
        display_title: 'OpenAI 模型动态',
        description: '围绕 OpenAI 模型更新、能力边界与产品变化的持续追踪。',
        post_count: 3,
        source_count: 8,
        avg_quality_score: 91,
        is_featured: true,
        latest_post_at: '2026-04-15T08:00:00Z',
      },
    ],
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders chinese topic titles and summaries', async () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <TopicsPage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByText('OpenAI 模型动态')).toBeInTheDocument()
  expect(await screen.findByText('主题总览')).toBeInTheDocument()
  expect(await screen.findByText('围绕 OpenAI 模型更新、能力边界与产品变化的持续追踪。')).toBeInTheDocument()
})
