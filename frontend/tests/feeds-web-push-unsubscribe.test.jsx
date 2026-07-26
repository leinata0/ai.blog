/**
 * 关闭浏览器提醒时，必须把 `keys.auth` 一起发给后端。
 *
 * endpoint 是一串会出现在网络路径和每次推送投递里的 URL；只凭它退订等于"知道 URL 就
 * 能替别人关掉提醒"。`keys.auth` 是推送服务只交给创建订阅那个浏览器的 16 字节随机值，
 * 是这里唯一真正的持有证明。
 *
 * 另一半是兜底：用户完全可能在订阅已经失效的情况下点"关闭提醒"（清了通知权限、换了
 * profile、service worker 被注销），这时 getSubscription() 返回 null——按钮不能崩，
 * 也不能拿着空 endpoint 去调后端。
 */
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'
import FeedsPage from '../src/pages/FeedsPage'

const fetchTopicsMock = vi.fn()
const fetchSeriesListMock = vi.fn()
const fetchSubscriptionStatusMock = vi.fn()
const unsubscribeWebPushMock = vi.fn()

vi.mock('../src/api/posts', () => ({
  fetchTopics: (...args) => fetchTopicsMock(...args),
  fetchSeriesList: (...args) => fetchSeriesListMock(...args),
}))

vi.mock('../src/api/subscriptions', () => ({
  fetchSubscriptionStatus: (...args) => fetchSubscriptionStatusMock(...args),
  subscribeEmail: vi.fn(),
  unsubscribeEmail: vi.fn(),
  confirmEmailSubscription: vi.fn(),
  fetchWebPushPublicKey: vi.fn(),
  subscribeWebPush: vi.fn(),
  unsubscribeWebPush: (...args) => unsubscribeWebPushMock(...args),
}))

const PUSH_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/browser-owned-endpoint'
const PUSH_AUTH = 'kZ3n-Ex4mPl3_auTHkey'

function makeSubscription({ auth = PUSH_AUTH, toJSON } = {}) {
  return {
    endpoint: PUSH_ENDPOINT,
    unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: toJSON === undefined
      ? () => ({ endpoint: PUSH_ENDPOINT, keys: { p256dh: 'p256dh-value', auth } })
      : toJSON,
  }
}

/**
 * @param subscriptions 依次返回给 pushManager.getSubscription() 的值。首次调用发生在
 *   页面挂载时（决定按钮显示"启用"还是"关闭"），第二次发生在点击"关闭"时。
 */
function installPushEnvironment(subscriptions) {
  const queue = [...subscriptions]
  const getSubscription = vi.fn(() => Promise.resolve(
    queue.length > 1 ? queue.shift() : queue[0],
  ))
  const registration = { pushManager: { getSubscription } }

  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') },
  })
  Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} })
  Object.defineProperty(window.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  })
  return { registration, getSubscription }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/feeds']}>
      <ThemeProvider>
        <FeedsPage />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/feeds')
  fetchTopicsMock.mockResolvedValue({ items: [] })
  fetchSeriesListMock.mockResolvedValue([])
  fetchSubscriptionStatusMock.mockResolvedValue({
    email_configured: true,
    web_push_configured: true,
    wecom_configured: false,
    web_push_public_key: 'public-key',
  })
  unsubscribeWebPushMock.mockResolvedValue({ is_active: false })
})

afterEach(() => {
  cleanup()
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  window.history.replaceState({}, '', '/feeds')
})

it('sends the subscription auth key as proof of possession when unsubscribing', async () => {
  const user = userEvent.setup()
  const subscription = makeSubscription()
  installPushEnvironment([subscription])
  renderPage()

  await user.click(await screen.findByRole('button', { name: '关闭浏览器提醒' }))

  expect(unsubscribeWebPushMock).toHaveBeenCalledWith({
    endpoint: PUSH_ENDPOINT,
    auth: PUSH_AUTH,
  })
  expect(subscription.unsubscribe).toHaveBeenCalled()
  expect(await screen.findByText('这个浏览器的提醒已关闭。')).toBeInTheDocument()
})

it('does not crash when the browser subscription is already gone', async () => {
  const user = userEvent.setup()
  // 挂载时还看得到订阅（所以按钮是"关闭提醒"），点下去时浏览器侧已经没有了。
  installPushEnvironment([makeSubscription(), null])
  renderPage()

  await user.click(await screen.findByRole('button', { name: '关闭浏览器提醒' }))

  // 没有 endpoint 也没有 auth，就没有任何可以出示的持有证明——不调后端。
  expect(unsubscribeWebPushMock).not.toHaveBeenCalled()
  expect(await screen.findByText('这个浏览器已经没有生效中的推送订阅，状态已同步。')).toBeInTheDocument()
  expect(screen.getByText('当前设备：未订阅')).toBeInTheDocument()
})

it('does not crash when the service worker registration is missing', async () => {
  const user = userEvent.setup()
  installPushEnvironment([makeSubscription()])
  renderPage()

  const button = await screen.findByRole('button', { name: '关闭浏览器提醒' })
  window.navigator.serviceWorker.getRegistration.mockResolvedValue(undefined)
  await user.click(button)

  expect(unsubscribeWebPushMock).not.toHaveBeenCalled()
  expect(await screen.findByText('这个浏览器已经没有生效中的推送订阅，状态已同步。')).toBeInTheDocument()
})

it('still unsubscribes when the subscription exposes no readable keys', async () => {
  const user = userEvent.setup()
  // 老浏览器没有 toJSON()：拿不到 auth 也要能退订，后端在宽松期会接受无证明的请求。
  const subscription = makeSubscription({ toJSON: null })
  installPushEnvironment([subscription])
  renderPage()

  await user.click(await screen.findByRole('button', { name: '关闭浏览器提醒' }))

  expect(unsubscribeWebPushMock).toHaveBeenCalledWith({ endpoint: PUSH_ENDPOINT, auth: '' })
  expect(subscription.unsubscribe).toHaveBeenCalled()
})
