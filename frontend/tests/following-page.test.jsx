import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FollowingPage from '../src/pages/FollowingPage'

beforeEach(() => {
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
  render(
    <MemoryRouter>
      <ThemeProvider>
        <FollowingPage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByRole('heading', { name: '关注与继续阅读' })).toBeInTheDocument()
  expect(screen.getAllByText('OpenAI 新模型').length).toBeGreaterThan(0)
  expect(screen.getByText('OpenAI 新模型日报')).toBeInTheDocument()
})
