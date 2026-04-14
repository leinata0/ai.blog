import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import ArchivePage from '../src/pages/ArchivePage'

vi.mock('../src/api/posts', () => ({
  fetchArchive: vi.fn(() =>
    Promise.resolve([
      {
        year: '2026',
        posts: [
          {
            title: 'OpenAI model update',
            slug: 'openai-model-update',
            created_at: '2026-04-14T10:00:00Z',
            coverage_date: '2026-04-14',
            content_type: 'daily_brief',
            series_slug: 'ai-daily-brief',
          },
          {
            title: 'Gemini product rhythm',
            slug: 'gemini-product-rhythm',
            created_at: '2026-04-14T12:30:00Z',
            coverage_date: '2026-04-14',
            content_type: 'daily_brief',
            series_slug: 'product-strategy-watch',
          },
          {
            title: 'Weekly AI review',
            slug: 'weekly-ai-review',
            created_at: '2026-04-13T08:00:00Z',
            coverage_date: '2026-04-13',
            content_type: 'weekly_review',
            series_slug: 'ai-weekly-review',
            is_pinned: true,
          },
        ],
      },
    ])
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders archive groups and supports content-type filtering', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <ArchivePage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByRole('heading', { name: '文章归档' })).toBeInTheDocument()
  expect(await screen.findByText('OpenAI model update')).toBeInTheDocument()
  expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-04-14"][data-group-size="2"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="archive-type-badge"][data-content-type="weekly_review"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: /每周回顾 1/i }))

  expect(await screen.findByText('Weekly AI review')).toBeInTheDocument()
  expect(screen.queryByText('OpenAI model update')).not.toBeInTheDocument()
  expect(container.querySelector('[data-ui="archive-type-chip"][data-content-type="weekly_review"]')).toBeTruthy()
})
