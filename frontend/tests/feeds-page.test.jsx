import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FeedsPage from '../src/pages/FeedsPage'

const fetchTopicsMock = vi.fn()
const fetchSubscriptionStatusMock = vi.fn()

vi.mock('../src/api/posts', () => ({
  fetchTopics: (...args) => fetchTopicsMock(...args),
}))

vi.mock('../src/api/subscriptions', () => ({
  fetchSubscriptionStatus: (...args) => fetchSubscriptionStatusMock(...args),
  subscribeEmail: vi.fn(),
  fetchWebPushPublicKey: vi.fn(),
  subscribeWebPush: vi.fn(),
  unsubscribeWebPush: vi.fn(),
}))

function renderPage() {
  return render(
    <MemoryRouter>
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

it('renders rss feeds and the new subscription channels', async () => {
  fetchTopicsMock.mockResolvedValue({
    items: [
      { topic_key: 'openai-models', display_title: 'OpenAI 模型', post_count: 12, source_count: 20, is_featured: true },
      { topic_key: 'agent-tools', display_title: '智能体工具链', post_count: 8, source_count: 11, is_featured: false },
    ],
  })
  fetchSubscriptionStatusMock.mockResolvedValue({
    email_configured: true,
    web_push_configured: false,
    wecom_configured: true,
    web_push_public_key: '',
  })

  renderPage()

  expect(await screen.findByRole('heading', { name: '先从最常用的 3 条 RSS 订阅开始' })).toBeInTheDocument()
  expect(fetchTopicsMock).toHaveBeenCalledWith({ featured: true, limit: 12 })
  expect(fetchSubscriptionStatusMock).toHaveBeenCalled()

  const coreFeedLinks = screen.getAllByRole('link', { name: /打开订阅地址/i })
  expect(coreFeedLinks).toHaveLength(3)
  expect(coreFeedLinks.map((item) => item.getAttribute('href'))).toEqual(
    expect.arrayContaining(['/feed.xml', '/api/feeds/daily.xml', '/api/feeds/weekly.xml']),
  )
  expect(screen.getByRole('heading', { name: '让新文章直接送到你的邮箱' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '在当前浏览器直接接收新内容通知' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '适合把新文章同步到团队群' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /保存邮件订阅/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /启用浏览器提醒/i })).toBeInTheDocument()
  expect(screen.getByText('当前企业微信机器人推送已接入，后续新文章会自动同步到已配置的群机器人。')).toBeInTheDocument()
})

it('renders empty state when topics are unavailable', async () => {
  fetchTopicsMock.mockResolvedValue({ items: [] })
  fetchSubscriptionStatusMock.mockResolvedValue({
    email_configured: false,
    web_push_configured: false,
    wecom_configured: false,
    web_push_public_key: '',
  })

  renderPage()

  expect(await screen.findByText('暂时还没有可展示的主题订阅')).toBeInTheDocument()
  expect(screen.getByText('当前企业微信机器人还未配置。站长只需在后端环境变量中设置 WECOM_WEBHOOK_URLS 即可启用。')).toBeInTheDocument()
})
