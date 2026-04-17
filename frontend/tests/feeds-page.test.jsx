import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FeedsPage from '../src/pages/FeedsPage'

const fetchTopicsMock = vi.fn()
const fetchSeriesListMock = vi.fn()
const fetchSubscriptionStatusMock = vi.fn()

vi.mock('../src/api/posts', () => ({
  fetchTopics: (...args) => fetchTopicsMock(...args),
  fetchSeriesList: (...args) => fetchSeriesListMock(...args),
}))

vi.mock('../src/api/subscriptions', () => ({
  fetchSubscriptionStatus: (...args) => fetchSubscriptionStatusMock(...args),
  subscribeEmail: vi.fn(),
  fetchWebPushPublicKey: vi.fn(),
  subscribeWebPush: vi.fn(),
  unsubscribeWebPush: vi.fn(),
}))

function renderPage(initialEntry = '/feeds') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ThemeProvider>
        <FeedsPage />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: false,
  })
})

it('renders subscription center with topic and series feeds plus prefilled scope', async () => {
  fetchTopicsMock.mockResolvedValue({
    items: [
      { topic_key: 'openai-models', display_title: 'OpenAI 模型', post_count: 12, source_count: 20, is_featured: true },
      { topic_key: 'agent-tools', display_title: '智能体工具链', post_count: 8, source_count: 11, is_featured: false },
    ],
  })
  fetchSeriesListMock.mockResolvedValue([
    { slug: 'ai-daily-brief', title: 'AI Daily Brief', description: 'Daily coverage.', post_count: 10, is_featured: true },
    { slug: 'ai-weekly-review', title: 'AI Weekly Review', description: 'Weekly review.', post_count: 5, is_featured: true },
  ])
  fetchSubscriptionStatusMock.mockResolvedValue({
    email_configured: true,
    web_push_configured: false,
    wecom_configured: true,
    web_push_public_key: '',
  })

  renderPage('/feeds?content_type=daily_brief&topic_key=openai-models&series_slug=ai-daily-brief')

  expect(await screen.findByRole('heading', { name: '把全站、主题和系列更新都收成稳定回访入口' })).toBeInTheDocument()
  expect(fetchTopicsMock).toHaveBeenCalledWith({ featured: true, limit: 12 })
  expect(fetchSeriesListMock).toHaveBeenCalledWith({ limit: 12 })
  expect(fetchSubscriptionStatusMock).toHaveBeenCalled()

  expect(screen.getByDisplayValue('AI 日报')).toBeInTheDocument()
  expect(screen.getByDisplayValue('OpenAI 模型')).toBeInTheDocument()
  expect(screen.getByDisplayValue('AI 日报')).toBeInTheDocument()
  expect(screen.getByText(/当前范围/i)).toBeInTheDocument()
  expect(screen.getByText(/主题：OpenAI 模型/i)).toBeInTheDocument()
  expect(screen.getByText(/系列：AI 日报/i)).toBeInTheDocument()

  const coreLinks = screen.getAllByRole('link', { name: /打开订阅地址/i })
  expect(coreLinks.length).toBe(3)
  expect(coreLinks.map((item) => item.getAttribute('href'))).toEqual(
    expect.arrayContaining(['/feed.xml', '/api/feeds/daily.xml', '/api/feeds/weekly.xml']),
  )
  expect(screen.getAllByRole('link', { name: /订阅这个主题|订阅这个系列/i }).length).toBeGreaterThan(0)
  expect(screen.getByRole('heading', { name: '让你关心的更新直接进邮箱' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '在当前设备直接收到新通知' })).toBeInTheDocument()
  expect(screen.getByText('当前企业微信机器人推送已接入，后续新文章会自动同步到已配置的群机器人。')).toBeInTheDocument()
})

it('renders empty states when topic and series feeds are unavailable', async () => {
  fetchTopicsMock.mockResolvedValue({ items: [] })
  fetchSeriesListMock.mockResolvedValue([])
  fetchSubscriptionStatusMock.mockResolvedValue({
    email_configured: false,
    web_push_configured: false,
    wecom_configured: false,
    web_push_public_key: '',
  })

  renderPage()

  expect(await screen.findByText('暂时还没有可展示的系列订阅')).toBeInTheDocument()
  expect(await screen.findByText('暂时还没有可展示的主题订阅')).toBeInTheDocument()
  expect(screen.getByText('当前企业微信机器人还未配置。站长只需在后端环境变量中设置 WECOM_WEBHOOK_URLS 即可启用。')).toBeInTheDocument()
})
