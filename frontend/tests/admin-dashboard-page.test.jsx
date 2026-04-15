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
  fetchQualityInbox: vi.fn(() =>
    Promise.resolve({
      summary: {
        total_posts: 1,
        with_snapshot_count: 1,
        reviewed_count: 0,
        followup_recommended_count: 0,
        avg_overall_score: 84,
      },
      items: [
        {
          post_id: 1,
          slug: 'openai-new-model',
          title: 'OpenAI released a new model',
          content_type: 'daily_brief',
          coverage_date: '2026-04-14',
          series_slug: 'ai-daily-brief',
          overall_score: 84,
          structure_score: 88,
          source_score: 80,
          analysis_score: 82,
          packaging_score: 76,
          resonance_score: 30,
          editor_verdict: '',
          followup_recommended: null,
          issues: ['missing_sources'],
          strengths: ['complete_structure'],
          snapshot_updated_at: '2026-04-14T10:04:00+00:00',
          reviewed_at: null,
        },
      ],
    })
  ),
  fetchPostQuality: vi.fn(() =>
    Promise.resolve({
      post: {
        id: 1,
        slug: 'openai-new-model',
        title: 'OpenAI released a new model',
        content_type: 'daily_brief',
        coverage_date: '2026-04-14',
        series_slug: 'ai-daily-brief',
      },
      quality_snapshot: {
        id: 1,
        post_id: 1,
        overall_score: 84,
        structure_score: 88,
        source_score: 80,
        analysis_score: 82,
        packaging_score: 76,
        resonance_score: 30,
        issues: ['missing_sources'],
        strengths: ['complete_structure'],
        notes: 'Quality snapshot generated after a passed gate.',
      },
      quality_review: null,
    })
  ),
  updatePostQualityReview: vi.fn(() => Promise.resolve({ id: 1, editor_verdict: 'solid' })),
  fetchTopicFeedback: vi.fn(() =>
    Promise.resolve({
      summary: {
        topic_count: 1,
        strong_topic_count: 1,
        weak_topic_count: 0,
      },
      items: [
        {
          topic_key: 'topic-a',
          series_slug: 'ai-daily-brief',
          content_type: 'daily_brief',
          post_count: 2,
          avg_overall_score: 86,
          avg_structure_score: 88,
          avg_source_score: 82,
          avg_analysis_score: 80,
          avg_packaging_score: 76,
          avg_resonance_score: 42,
          avg_views: 120,
          avg_likes: 8,
          followup_rate: 100,
          dominant_issues: ['missing_sources'],
          latest_post_title: 'OpenAI released a new model',
          latest_post_slug: 'openai-new-model',
          recommendation: 'expand',
        },
      ],
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
  fetchAdminQualityInbox: mocks.fetchQualityInbox,
  fetchAdminPostQuality: mocks.fetchPostQuality,
  updateAdminPostQualityReview: mocks.updatePostQualityReview,
  fetchAdminTopicFeedback: mocks.fetchTopicFeedback,
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

  await userEvent.click(screen.getByRole('button', { name: '发布状态' }))

  expect(await screen.findByText('最近一次日报运行')).toBeInTheDocument()
  expect(screen.getByText('已发布 1 篇文章')).toBeInTheDocument()
  expect(screen.getAllByText('Topic A').length).toBeGreaterThan(0)
  expect(screen.getByText('检测到重复 topic_key')).toBeInTheDocument()
})

it('opens quality inbox and topic feedback tabs without crashing when backend data is sparse', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getAllByRole('button', { name: '质量收件箱' })[0])
  expect(document.querySelector('[data-ui="admin-quality-inbox"]')).toBeTruthy()
  expect(screen.getAllByText('质量收件箱').length).toBeGreaterThan(1)

  await userEvent.click(screen.getAllByRole('button', { name: '主题反馈' })[0])
  expect(document.querySelector('[data-ui="admin-topic-feedback"]')).toBeTruthy()
  expect(await screen.findByText('建议扩展')).toBeInTheDocument()
})

it('opens content health and series tabs without crashing', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getAllByRole('button', { name: '内容健康' })[0])
  expect(document.querySelector('[data-ui="admin-content-health"]')).toBeTruthy()

  await userEvent.click(screen.getAllByRole('button', { name: '系列管理' })[0])
  expect(document.querySelector('[data-ui="admin-series-manager"]')).toBeTruthy()
})
