import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import AdminDashboardPage from '../src/pages/AdminDashboardPage'

vi.mock('../src/api/admin', () => ({
  fetchAdminPosts: vi.fn(() =>
    Promise.resolve({
      items: [
        {
          id: 1,
          title: 'OpenAI 发布新模型',
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
  adminDeletePost: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  fetchAdminPublishingStatus: vi.fn(() =>
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
      recent_runs: [],
      recent_posts: [
        {
          id: 1,
          title: 'OpenAI 发布新模型',
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
    })
  ),
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

it('renders publishing status tab and shows latest publishing snapshot', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('OpenAI 发布新模型')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: /发布状态/i }))

  expect(await screen.findByText('最近一次日更自动发布')).toBeInTheDocument()
  expect(screen.getByText('Published 1 post')).toBeInTheDocument()
  expect(screen.getAllByText('Topic A').length).toBeGreaterThan(0)
  expect(screen.getByText('duplicate topic_key detected')).toBeInTheDocument()
})
