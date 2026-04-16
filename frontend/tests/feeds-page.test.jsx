import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FeedsPage from '../src/pages/FeedsPage'

const fetchTopicsMock = vi.fn()

vi.mock('../src/api/posts', () => ({
  fetchTopics: (...args) => fetchTopicsMock(...args),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <FeedsPage />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders core feeds and topic feed links', async () => {
  fetchTopicsMock.mockResolvedValue({
    items: [
      { topic_key: 'openai-models', display_title: 'OpenAI 模型', post_count: 12, source_count: 20, is_featured: true },
      { topic_key: 'agent-tools', display_title: '智能体工具链', post_count: 8, source_count: 11, is_featured: false },
    ],
  })

  renderPage()

  expect(await screen.findByRole('heading', { name: '先从最常用的 3 条订阅开始' })).toBeInTheDocument()
  expect(fetchTopicsMock).toHaveBeenCalledWith({ featured: true, limit: 12 })

  const coreFeedLinks = screen.getAllByRole('link', { name: /打开订阅地址/i })
  expect(coreFeedLinks).toHaveLength(3)
  expect(coreFeedLinks.map((item) => item.getAttribute('href'))).toEqual(
    expect.arrayContaining(['/feed.xml', '/api/feeds/daily.xml', '/api/feeds/weekly.xml']),
  )
  const topicFeedLinks = screen.getAllByRole('link', { name: /订阅这个主题/i })
  expect(topicFeedLinks.map((item) => item.getAttribute('href'))).toEqual(
    expect.arrayContaining(['/api/feeds/topics/openai-models.xml']),
  )
  expect(screen.getByRole('link', { name: /查看 AI 日报/i })).toHaveAttribute('href', '/daily')
  expect(screen.getByRole('link', { name: /查看 AI 周报/i })).toHaveAttribute('href', '/weekly')
})

it('renders empty state when topics are unavailable', async () => {
  fetchTopicsMock.mockResolvedValue({ items: [] })

  renderPage()

  expect(await screen.findByText('暂时还没有可展示的主题订阅')).toBeInTheDocument()
})
