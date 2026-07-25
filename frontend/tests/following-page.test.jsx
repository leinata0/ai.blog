import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FollowingPage from '../src/pages/FollowingPage'

const mocks = vi.hoisted(() => ({
  currentUser: null,
  fetchCloudTopics: vi.fn(),
  fetchCloudHistory: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({ user: mocks.currentUser }),
}))

vi.mock('../src/api/user', () => ({
  fetchCloudTopics: mocks.fetchCloudTopics,
  fetchCloudHistory: mocks.fetchCloudHistory,
}))

function page() {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <FollowingPage />
      </ThemeProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.currentUser = null
  window.localStorage.clear()
  window.localStorage.setItem('blog.followed_topics', JSON.stringify([
    {
      topic_key: 'openai-new-model',
      display_title: 'OpenAI 新模型',
      followed_at: '2026-04-15T10:00:00.000Z',
    },
  ]))
  window.localStorage.setItem('blog.reading_history', JSON.stringify([
    {
      slug: 'openai-new-model-brief',
      title: 'OpenAI 新模型日报',
      topic_key: 'openai-new-model',
      content_type: 'daily_brief',
      visited_at: '2026-04-15T10:30:00.000Z',
    },
  ]))
})

afterEach(() => {
  cleanup()
})

it('renders followed topics and continue reading from local storage', async () => {
  render(page())

  expect(await screen.findByRole('heading', { name: '关注与继续阅读' })).toBeInTheDocument()
  expect(screen.getAllByText('OpenAI 新模型').length).toBeGreaterThan(0)
  expect(screen.getByText('OpenAI 新模型日报')).toBeInTheDocument()
})

it('ignores previous-account cloud responses after logout', async () => {
  let resolveTopics
  let resolveHistory
  const topicsPromise = new Promise((resolve) => {
    resolveTopics = resolve
  })
  const historyPromise = new Promise((resolve) => {
    resolveHistory = resolve
  })
  mocks.currentUser = { id: 1, email: 'previous@example.com' }
  mocks.fetchCloudTopics.mockReturnValue(topicsPromise)
  mocks.fetchCloudHistory.mockReturnValue(historyPromise)

  const view = render(page())
  mocks.currentUser = null
  view.rerender(page())

  await act(async () => {
    resolveTopics([{ topic_key: 'private-topic', display_title: '上一账号的私密主题' }])
    resolveHistory([{
      slug: 'private-history',
      title: '上一账号的阅读记录',
      topic_key: 'private-topic',
      visited_at: '2026-07-25T12:00:00.000Z',
    }])
    await Promise.all([topicsPromise, historyPromise])
  })

  expect(screen.queryByText('上一账号的私密主题')).toBeNull()
  expect(screen.queryByText('上一账号的阅读记录')).toBeNull()
  expect(screen.getAllByText('OpenAI 新模型').length).toBeGreaterThan(0)
  expect(screen.getByText('OpenAI 新模型日报')).toBeInTheDocument()
})
