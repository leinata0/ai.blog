import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import AdminDashboardPage from '../src/pages/AdminDashboardPage'
import { dismissAdminJob, getAdminJobs } from '../src/components/admin/adminJobsStore'

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
      page_size: 20,
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
          description: '跟踪 OpenAI 新模型动态。',
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
  probeEndpointHealth: vi.fn(() =>
    Promise.resolve({
      checked_at: '2026-04-16T01:00:00.000Z',
      overview: { total: 8, ok: 7, slow: 0, failed: 1 },
      items: [
        {
          key: 'feed-root',
          label: '全站 RSS',
          path: '/feed.xml',
          status: 'http_error',
          ok: false,
          status_code: 404,
          duration_ms: 120,
          checked_at: '2026-04-16T01:00:00.000Z',
          summary: 'HTTP 404',
          detail: 'not found',
        },
      ],
    })
  ),
  generateAdminPostCover: vi.fn(() => Promise.resolve({ job_id: 123, status: 'queued' })),
  fetchAdminGenerationJobs: vi.fn(() => Promise.resolve({ items: [], total: 0 })),
  fetchSubscriptionHealth: vi.fn(() =>
    Promise.resolve({
      checked_at: '2026-04-16T01:00:00.000Z',
      email: {
        configured: false,
        missing_env: ['RESEND_API_KEY', 'EMAIL_FROM'],
        message: '邮件订阅未完成配置。',
      },
      web_push: {
        configured: true,
        missing_env: [],
        has_public_key: true,
        message: '浏览器提醒已接入。',
      },
      wecom: {
        configured: false,
        missing_env: ['WECOM_WEBHOOK_URLS'],
        message: '企业微信机器人当前未配置。',
      },
    })
  ),
}))

vi.mock('../src/api/admin', () => ({
  fetchAdminPosts: mocks.fetchAdminPosts,
  adminDeletePost: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  adminUpdatePost: vi.fn(() => Promise.resolve({ detail: 'updated' })),
  generateAdminPostCover: mocks.generateAdminPostCover,
  fetchAdminGenerationJobs: mocks.fetchAdminGenerationJobs,
  fetchSettings: vi.fn(() =>
    Promise.resolve({
      author_name: '站点作者',
      bio: '简介',
      avatar_url: '',
      hero_image: '',
      github_link: '',
      announcement: '',
      site_url: 'https://example.com',
      friend_links: '[]',
    })
  ),
  fetchAdminSettings: vi.fn(() =>
    Promise.resolve({
      author_name: '站点作者',
      bio: '简介',
      avatar_url: '',
      hero_image: '',
      github_link: '',
      announcement: '',
      site_url: 'https://example.com',
      friend_links: '[]',
    })
  ),
  updateSettings: vi.fn(() => Promise.resolve({})),
  adminUploadImage: vi.fn(() => Promise.resolve({ url: '/uploads/demo.png' })),
  generateAdminHeroImage: vi.fn(() =>
    Promise.resolve({
      generated: true,
      hero_image: '/uploads/site-hero.png',
      prompt: 'editorial hero',
      error: '',
      error_code: '',
    })
  ),
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
  generateAdminSeriesCover: vi.fn(() => Promise.resolve({ generated: false, cover_image: '', error: '' })),
  fetchAdminCoverGenerationStatus: vi.fn(() =>
    Promise.resolve({
      provider: 'grok',
      has_xai_api_key: true,
      can_generate: true,
      supports_site_hero: true,
      message: '后端已检测到 XAI_API_KEY。',
    })
  ),
  fetchAdminAiProviderSources: vi.fn(() => Promise.resolve([
    {
      id: 1,
      name: 'Main Gateway',
      provider: 'openai_compatible',
      protocol: 'openai',
      base_url: 'https://gateway.example.com/v1',
      api_key_env_var: 'AI_API_KEY',
      has_api_key: true,
      api_key_source: 'env',
      masked_api_key: 'sk-...demo',
      enabled: true,
      extra_json: '{}',
    },
  ])),
  createAdminAiProviderSource: vi.fn(() => Promise.resolve({ id: 2, name: 'New Gateway' })),
  updateAdminAiProviderSource: vi.fn(() => Promise.resolve({ id: 1, name: 'Main Gateway' })),
  deleteAdminAiProviderSource: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  fetchAdminAiProviderSourceModels: vi.fn(() => Promise.resolve({
    ok: true,
    message: '已获取模型列表。',
    latency_ms: 12,
    models: [{ id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' }],
  })),
  fetchAdminAiModelInstances: vi.fn(() => Promise.resolve([
    {
      id: 11,
      source_id: 1,
      source_name: 'Main Gateway',
      name: 'Text Primary',
      provider: 'openai_compatible',
      protocol: 'openai',
      base_url: 'https://gateway.example.com/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      purpose: 'text_generation',
      capabilities: ['text_generation'],
      priority: 1,
      enabled: true,
      source_enabled: true,
      is_default: true,
      is_configured: true,
      extra_json: '{}',
    },
  ])),
  createAdminAiModelInstance: vi.fn(() => Promise.resolve({ id: 12, model: 'grok-4' })),
  updateAdminAiModelInstance: vi.fn(() => Promise.resolve({ id: 11, model: 'deepseek-ai/DeepSeek-V3' })),
  deleteAdminAiModelInstance: vi.fn(() => Promise.resolve({ detail: 'deleted' })),
  updateAdminAiModelOrder: vi.fn(() => Promise.resolve([])),
  testAdminAiModelInstance: vi.fn(() => Promise.resolve({ ok: true, message: 'AI 模型实例测试成功。', latency_ms: 21 })),
  fetchAdminAiRuntimePlan: vi.fn(() => Promise.resolve({
    image_generation: [],
    text_generation: [
      { instance_id: 11, source_id: 1, name: 'Text Primary', source_name: 'Main Gateway', provider: 'openai_compatible', model: 'deepseek-ai/DeepSeek-V3' },
    ],
  })),
  fetchAdminTopicProfiles: mocks.fetchTopicProfiles,
  createAdminTopicProfile: vi.fn(() => Promise.resolve({})),
  updateAdminTopicProfile: vi.fn(() => Promise.resolve({})),
  generateAdminTopicProfileCover: vi.fn(() => Promise.resolve({ generated: false, cover_image: '', error: '' })),
  fetchAdminTopicHealth: mocks.fetchTopicHealth,
  fetchAdminSearchInsights: mocks.fetchSearchInsights,
  probeAdminEndpointHealth: mocks.probeEndpointHealth,
  fetchAdminSubscriptionHealth: mocks.fetchSubscriptionHealth,
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
  mocks.fetchAdminPosts.mockResolvedValue({
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
    page_size: 20,
  })
  mocks.generateAdminPostCover.mockResolvedValue({ job_id: 123, status: 'queued' })
  mocks.fetchAdminGenerationJobs.mockResolvedValue({ items: [], total: 0 })
  window.sessionStorage.clear()
  window.localStorage.clear()
  getAdminJobs().forEach((job) => dismissAdminJob(job.localId))
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
  expect(screen.getByRole('tab', { name: /文章管理/ })).toBeInTheDocument()
  expect(mocks.fetchAdminPosts).toHaveBeenCalledWith({ page: 1, page_size: 20 }, expect.anything())
})

it('renders pagination metadata and loads the next page', async () => {
  mocks.fetchAdminPosts
    .mockResolvedValueOnce({
      items: [
        {
          id: 1,
          title: 'Newest post',
          slug: 'newest-post',
          summary: 'summary',
          cover_image: '',
          content_type: 'post',
          published_mode: 'manual',
          coverage_date: '2026-04-14',
          is_published: true,
          is_pinned: false,
          tags: [],
        },
        {
          id: 2,
          title: 'Second post',
          slug: 'second-post',
          summary: 'summary',
          cover_image: '',
          content_type: 'post',
          published_mode: 'manual',
          coverage_date: '2026-04-13',
          is_published: true,
          is_pinned: false,
          tags: [],
        },
      ],
      total: 55,
      page: 1,
      page_size: 20,
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: 21,
          title: 'Older post',
          slug: 'older-post',
          summary: 'summary',
          cover_image: '',
          content_type: 'post',
          published_mode: 'manual',
          coverage_date: '2026-03-01',
          is_published: true,
          is_pinned: false,
          tags: [],
        },
      ],
      total: 55,
      page: 2,
      page_size: 20,
    })

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('Newest post')).toBeInTheDocument()
  expect(screen.getByText('显示 1–2 / 共 55 篇')).toBeInTheDocument()
  expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('button', { name: '下一页' }))

  expect(await screen.findByText('Older post')).toBeInTheDocument()
  expect(mocks.fetchAdminPosts).toHaveBeenLastCalledWith({ page: 2, page_size: 20 }, {})
})

it('resets pagination to the first page when applying filters', async () => {
  mocks.fetchAdminPosts
    .mockResolvedValueOnce({
      items: [{ id: 1, title: 'First page post', slug: 'first-page-post', cover_image: '', content_type: 'post', published_mode: 'manual', is_published: true, is_pinned: false, tags: [] }],
      total: 40,
      page: 1,
      page_size: 20,
    })
    .mockResolvedValueOnce({
      items: [{ id: 21, title: 'Second page post', slug: 'second-page-post', cover_image: '', content_type: 'post', published_mode: 'manual', is_published: true, is_pinned: false, tags: [] }],
      total: 40,
      page: 2,
      page_size: 20,
    })
    .mockResolvedValueOnce({
      items: [{ id: 3, title: 'Filtered post', slug: 'filtered-post', cover_image: '', content_type: 'post', published_mode: 'manual', is_published: true, is_pinned: false, tags: [] }],
      total: 1,
      page: 1,
      page_size: 20,
    })

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('First page post')
  await userEvent.click(screen.getByRole('button', { name: '下一页' }))
  await screen.findByText('Second page post')

  await userEvent.type(screen.getByPlaceholderText('标题 / slug / topic_key'), 'filtered')
  await userEvent.click(screen.getByRole('button', { name: '应用筛选' }))

  expect(await screen.findByText('Filtered post')).toBeInTheDocument()
  expect(mocks.fetchAdminPosts).toHaveBeenLastCalledWith({ page: 1, page_size: 20, q: 'filtered' }, {})
})

it('bulk-generates covers only for selected current-page posts missing covers', async () => {
  const adminApi = await import('../src/api/admin')
  mocks.fetchAdminPosts.mockResolvedValue({
    items: [
      {
        id: 1,
        title: 'Post without cover',
        slug: 'post-without-cover',
        summary: 'summary',
        cover_image: '',
        content_type: 'post',
        published_mode: 'manual',
        coverage_date: '2026-04-14',
        is_published: true,
        is_pinned: false,
        tags: [],
      },
      {
        id: 2,
        title: 'Post with cover',
        slug: 'post-with-cover',
        summary: 'summary',
        cover_image: 'https://example.com/cover.jpg',
        content_type: 'post',
        published_mode: 'manual',
        coverage_date: '2026-04-14',
        is_published: true,
        is_pinned: false,
        tags: [],
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  })

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('Post without cover')).toBeInTheDocument()
  expect(await screen.findByText('Post with cover')).toBeInTheDocument()

  await userEvent.click(screen.getByLabelText('选择当前页文章'))
  expect(screen.getByText('已选择当前页：2')).toBeInTheDocument()
  expect(screen.getByText(/未勾选时，“为无封面文章生成封面”会处理当前页所有无封面文章/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '为已选无封面生成封面 (1)' }))

  await waitFor(() => {
    expect(adminApi.generateAdminPostCover).toHaveBeenCalledWith(1, { mode: 'apply', overwrite: false }, { timeout: 12000 })
  })
  expect(adminApi.generateAdminPostCover).toHaveBeenCalledTimes(1)
  expect(adminApi.generateAdminPostCover).not.toHaveBeenCalledWith(2, expect.anything())
  expect(await screen.findByText(/已提交 1 篇无封面文章的封面生成任务，跳过 1 篇已有封面的文章/)).toBeInTheDocument()
  expect(screen.queryByText(/正在提交 \d+ 篇文章的封面生成任务/)).not.toBeInTheDocument()
})

it('bulk-generates current-page missing covers without requiring manual selection', async () => {
  const adminApi = await import('../src/api/admin')
  mocks.fetchAdminPosts.mockResolvedValue({
    items: [
      {
        id: 1,
        title: 'No cover one',
        slug: 'no-cover-one',
        summary: 'summary',
        cover_image: '',
        content_type: 'post',
        published_mode: 'manual',
        coverage_date: '2026-04-14',
        is_published: true,
        is_pinned: false,
        tags: [],
      },
      {
        id: 2,
        title: 'No cover two',
        slug: 'no-cover-two',
        summary: 'summary',
        cover_image: '',
        content_type: 'post',
        published_mode: 'manual',
        coverage_date: '2026-04-14',
        is_published: true,
        is_pinned: false,
        tags: [],
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
  })

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('No cover one')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '为当前页无封面生成封面 (2)' }))

  await waitFor(() => {
    expect(adminApi.generateAdminPostCover).toHaveBeenCalledWith(1, { mode: 'apply', overwrite: false }, { timeout: 12000 })
    expect(adminApi.generateAdminPostCover).toHaveBeenCalledWith(2, { mode: 'apply', overwrite: false }, { timeout: 12000 })
  })
  expect(adminApi.generateAdminPostCover).toHaveBeenCalledTimes(2)
  expect(await screen.findByText(/已提交 2 篇无封面文章的封面生成任务/)).toBeInTheDocument()
  expect(screen.queryByText(/正在提交 \d+ 篇文章的封面生成任务/)).not.toBeInTheDocument()
})

it('shows the underlying error when all selected cover submissions fail', async () => {
  mocks.generateAdminPostCover.mockRejectedValue(new Error('missing provider config'))
  mocks.fetchAdminPosts.mockResolvedValue({
    items: [
      {
        id: 1,
        title: 'No provider post',
        slug: 'no-provider-post',
        summary: 'summary',
        cover_image: '',
        content_type: 'post',
        published_mode: 'manual',
        coverage_date: '2026-04-14',
        is_published: true,
        is_pinned: false,
        tags: [],
      },
    ],
    total: 1,
    page: 1,
    page_size: 20,
  })

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  expect(await screen.findByText('No provider post')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '为当前页无封面生成封面 (1)' }))

  expect(await screen.findByText('批量封面生成提交失败：missing provider config')).toBeInTheDocument()
})

it('opens topic management, topic health, and search insights tabs', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getByRole('tab', { name: /主题管理/ }))
  expect(await screen.findByText('OpenAI 新模型')).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-topic-profiles"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('tab', { name: /主题健康/ }))
  expect(await screen.findByText(/平均质量分/)).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-topic-health"]')).toBeTruthy()

  await userEvent.click(screen.getByRole('tab', { name: /搜索洞察/ }))
  expect(await screen.findByText('OpenAI')).toBeInTheDocument()
  expect(await screen.findByText('Mamba 2')).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-search-insights"]')).toBeTruthy()
})

it('opens endpoint health tab and renders probe and subscription results', async () => {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')

  await userEvent.click(screen.getByRole('tab', { name: /接口与订阅健康/ }))

  expect(await screen.findByRole('heading', { name: /接口与订阅健康/ })).toBeInTheDocument()
  expect(await screen.findByText('/feed.xml')).toBeInTheDocument()
  expect(await screen.findByText('HTTP 404')).toBeInTheDocument()
  expect(await screen.findByText('订阅配置')).toBeInTheDocument()
  expect(await screen.findByText('RESEND_API_KEY')).toBeInTheDocument()
  expect(await screen.findByText(/VAPID 公钥/)).toBeInTheDocument()
  expect(document.querySelector('[data-ui="admin-endpoint-health"]')).toBeTruthy()
  expect(document.querySelector('[data-ui="admin-subscription-health"]')).toBeTruthy()
})

it('opens settings and manages AI provider sources and model instances', async () => {
  const adminApi = await import('../src/api/admin')

  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>
  )

  await screen.findByText('OpenAI released a new model')
  await userEvent.click(screen.getByRole('tab', { name: /站点设置/ }))
  expect(await screen.findByRole('tab', { name: /AI Provider/ })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: /AI Provider/ }))

  expect(await screen.findByText('AI Provider 配置')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /AI API 渠道配置/ })).not.toBeInTheDocument()
  expect((await screen.findAllByText('Main Gateway')).length).toBeGreaterThan(0)
  expect(await screen.findByText('Text Primary')).toBeInTheDocument()
  expect((await screen.findAllByText(/deepseek-ai\/DeepSeek-V3/)).length).toBeGreaterThan(0)

  await userEvent.click(screen.getByRole('button', { name: '发现模型' }))
  expect(await screen.findByText(/已获取模型列表/)).toBeInTheDocument()
  expect(adminApi.fetchAdminAiProviderSourceModels).toHaveBeenCalledWith(1)

  await userEvent.click(screen.getByRole('button', { name: '测试' }))
  expect(await screen.findByText(/AI 模型实例测试成功/)).toBeInTheDocument()
  expect(adminApi.testAdminAiModelInstance).toHaveBeenCalledWith(11)

  await userEvent.click(screen.getByRole('button', { name: '保存 生文字 API 顺序' }))
  expect(await screen.findByText(/生文字 API 模型顺序已保存/)).toBeInTheDocument()
  expect(adminApi.updateAdminAiModelOrder).toHaveBeenCalledWith(expect.objectContaining({
    purpose: 'text_generation',
    items: expect.arrayContaining([expect.objectContaining({ id: 11, priority: 1, is_default: true })]),
  }))
})

