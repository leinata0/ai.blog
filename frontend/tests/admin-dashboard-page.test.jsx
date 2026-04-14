import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import AdminDashboardPage from '../src/pages/AdminDashboardPage'

const mocks = vi.hoisted(() => ({
  fetchAdminPosts: vi.fn(() =>
    Promise.resolve({
      items: [
        {
          id: 1,
          title: 'OpenAI released a new model',
          slug: 'openai-new-model',
          summary: 'summary',
          cover_image: '',
          content_type: 'daily_brief',
          topic_key: 'openai-new-model',
          published_mode: 'auto',
          coverage_date: '2026-04-14',
          view_count: 10,
          is_published: true,
          is_pinned: false,
          like_count: 2,
          created_at: '2026-04-14T10:00:00+00:00',
          updated_at: '2026-04-14T10:00:00+00:00',
          tags: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
    })
  ),
  fetchPublishingStatus: vi.fn(() =>
    Promise.resolve({
      latest_runs: {
        daily_auto: {
          id: 1,
          workflow_key: 'daily_auto',
          external_run_id: 'gha-1',
          run_mode: 'auto',
          status: 'success',
          coverage_date: '2026-04-14',
          message: 'Published 1 post',
          started_at: '2026-04-14T10:00:00+00:00',
          finished_at: '2026-04-14T10:03:00+00:00',
          updated_at: '2026-04-14T10:03:00+00:00',
          summary: {
            candidate_count: 3,
            published_count: 1,
            skipped_count: 2,
            auto_published_count: 1,
            manual_published_count: 0,
          },
          candidate_topics: [{ topic_key: 'topic-a', title: 'Topic A', source_count: 3, source_names: ['OpenAI Blog'] }],
          published_topics: [{ topic_key: 'topic-a', title: 'Topic A', post_slug: 'topic-a', published_mode: 'auto' }],
          skipped_topics: [{ topic_key: 'topic-b', title: 'Topic B', reason: 'duplicate topic_key detected' }],
        },
        weekly_review: null,
      },
      recent_runs: [
        {
          id: 99,
          workflow_key: 'daily_auto',
          run_mode: 'auto',
          status: 'success',
          coverage_date: '2026-04-14',
          summary: { candidate_count: 3, published_count: 1, skipped_count: 2 },
        },
      ],
      recent_posts: [],
    })
  ),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminPosts: mocks.fetchAdminPosts,
  adminDeletePost: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  adminUpdatePost: vi.fn(() => Promise.resolve({ detail: 'updated' })),
  fetchAdminPublishingStatus: mocks.fetchPublishingStatus,
  fetchAdminPublishingRunDetail: vi.fn(() =>
    Promise.resolve({
      id: 99,
      summary: { candidate_count: 3, published_count: 1, skipped_count: 2 },
      candidate_topics: [],
      published_topics: [],
      skipped_topics: [],
    })
  ),
  fetchAdminContentHealth: vi.fn(() => Promise.resolve({ overview: { total_posts: 10 } })),
  fetchAdminSeries: vi.fn(() => Promise.resolve({ items: [] })),
  createAdminSeries: vi.fn(() => Promise.resolve({})),
  updateAdminSeries: vi.fn(() => Promise.resolve({})),
}))

vi.mock('../src/api/auth', async () => {
  const actual = await vi.importActual('../src/api/auth')
  return {
    ...actual,
    getToken: vi.fn(() => 'token'),
    clearToken: vi.fn(),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
})

it('renders publishing tab and shows latest publishing snapshot', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('OpenAI released a new model')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /publishing/i }))

  expect(await screen.findByText('Latest Daily Auto Run')).toBeInTheDocument()
  expect(screen.getByText('Published 1 post')).toBeInTheDocument()
  expect(screen.getAllByText('Topic A').length).toBeGreaterThan(0)
  expect(screen.getByText('duplicate topic_key detected')).toBeInTheDocument()
})

it('opens content health and series tabs without crashing when backend data is sparse', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getAllByRole('button', { name: /content health/i })[0])
  expect(document.querySelector('[data-ui="admin-content-health"]')).toBeTruthy()

  await userEvent.click(screen.getAllByRole('button', { name: /series/i })[0])
  expect(document.querySelector('[data-ui="admin-series-manager"]')).toBeTruthy()
})
