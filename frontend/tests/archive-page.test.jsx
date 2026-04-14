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
            title: 'OpenAI 发布模型更新',
            slug: 'openai-model-update',
            created_at: '2026-04-14T10:00:00Z',
            coverage_date: '2026-04-14',
            content_type: 'daily_brief',
          },
          {
            title: 'Google Gemini 产品节奏变化',
            slug: 'gemini-product-rhythm',
            created_at: '2026-04-14T12:30:00Z',
            coverage_date: '2026-04-14',
            content_type: 'daily_brief',
          },
          {
            title: '本周 AI 产品与模型变化回顾',
            slug: 'weekly-ai-review',
            created_at: '2026-04-13T08:00:00Z',
            coverage_date: '2026-04-13',
            content_type: 'weekly_review',
          },
        ],
      },
    ])
  ),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

it('renders archive day groups and filters by content type', async () => {
  const { container } = render(
    <MemoryRouter>
      <ThemeProvider>
        <ArchivePage />
      </ThemeProvider>
    </MemoryRouter>
  )

  expect(await screen.findByRole('heading', { name: '文章归档' })).toBeInTheDocument()
  expect(await screen.findByText('OpenAI 发布模型更新')).toBeInTheDocument()
  expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-04-14"][data-group-size="2"]')).toBeTruthy()
  expect(container.querySelector('[data-ui="archive-type-badge"][data-content-type="weekly_review"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: /每周回顾 1/i }))

  expect(await screen.findByText('本周 AI 产品与模型变化回顾')).toBeInTheDocument()
  expect(screen.queryByText('OpenAI 发布模型更新')).not.toBeInTheDocument()
  expect(container.querySelector('[data-ui="archive-type-chip"][data-content-type="weekly_review"]')).toBeTruthy()
})
