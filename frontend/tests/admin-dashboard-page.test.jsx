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
      latest_runs: { daily_auto: null, weekly_review: null },
      recent_runs: [],
      recent_posts: [],
    })
  ),
  fetchQualityInbox: vi.fn(() =>
    Promise.resolve({
      summary: { total_posts: 1 },
      items: [],
    })
  ),
  fetchPostQuality: vi.fn(() =>
    Promise.resolve({
      post: { id: 1, slug: 'openai-new-model', title: 'OpenAI released a new model' },
      quality_snapshot: null,
      quality_review: null,
    })
  ),
  fetchTopicFeedback: vi.fn(() =>
    Promise.resolve({
      summary: { topic_count: 1 },
      items: [],
    })
  ),
  fetchTopicProfiles: vi.fn(() =>
    Promise.resolve({
      items: [
        {
          id: 1,
          topic_key: 'openai-new-model',
          display_title: 'OpenAI 新模型',
          description: '跟踪 OpenAI 新模型节奏',
          aliases: ['openai'],
          is_featured: true,
          sort_order: 10,
          latest_post_at: '2026-04-14T10:00:00+00:00',
        },
      ],
    })
  ),
  fetchTopicHealth: vi.fn(() =>
    Promise.resolve({
      summary: { topic_count: 1, avg_quality_score: 88 },
      items: [
        {
          topic_key: 'openai-new-model',
          display_title: 'OpenAI 新模型',
          post_count: 3,
          avg_quality_score: 88,
          source_count: 7,
          latest_post_at: '2026-04-14T10:00:00+00:00',
        },
      ],
    })
  ),
  fetchSearchInsights: vi.fn(() =>
    Promise.resolve({
      summary: { search_count: 2 },
      top_queries: [{ query: 'OpenAI', result_count: 4, clicked_topic_key: 'openai-new-model' }],
      zero_result_queries: [{ query: 'Mamba 2', result_count: 0 }],
    })
  ),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminPosts: mocks.fetchAdminPosts,
  adminDeletePost: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  adminUpdatePost: vi.fn(() => Promise.resolve({ detail: 'updated' })),
  fetchAdminPublishingStatus: mocks.fetchPublishingStatus,
  fetchAdminPublishingRunDetail: vi.fn(() => Promise.resolve({ id: 99, summary: {} })),
  fetchAdminContentHealth: vi.fn(() => Promise.resolve({ summary: { total_posts: 10 }, items: [] })),
  fetchAdminQualityInbox: mocks.fetchQualityInbox,
  fetchAdminPostQuality: mocks.fetchPostQuality,
  updateAdminPostQualityReview: vi.fn(() => Promise.resolve({ id: 1 })),
  fetchAdminTopicFeedback: mocks.fetchTopicFeedback,
  fetchAdminSeries: vi.fn(() => Promise.resolve({ items: [] })),
  createAdminSeries: vi.fn(() => Promise.resolve({})),
  updateAdminSeries: vi.fn(() => Promise.resolve({})),
  fetchAdminTopicProfiles: mocks.fetchTopicProfiles,
  createAdminTopicProfile: vi.fn(() => Promise.resolve({})),
  updateAdminTopicProfile: vi.fn(() => Promise.resolve({})),
  fetchAdminTopicHealth: mocks.fetchTopicHealth,
  fetchAdminSearchInsights: mocks.fetchSearchInsights,
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

it('renders the posts tab by default', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('OpenAI released a new model')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '文章管理' })).toBeInTheDocument()
})

it('opens topic management, topic health, and search insights tabs', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getByRole('button', { name: '主题管理' }))
  expect(await screen.findByText('OpenAI 新模型')).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-topic-profiles"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: '主题健康' }))
  expect(await screen.findByText('平均质量分')).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-topic-health"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('button', { name: '搜索洞察' }))
  expect(await screen.findByText('OpenAI')).toBeInTheDocument()
  expect(await screen.findByText('Mamba 2')).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-search-insights"]')).toBeTruthy()
})
