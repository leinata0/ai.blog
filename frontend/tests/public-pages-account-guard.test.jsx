import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  fetchAccountDashboard: vi.fn(),
  fetchAccountLibrary: vi.fn(),
  fetchAccountExport: vi.fn(),
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  changePassword: vi.fn(),
  clearCloudHistory: vi.fn(),
  removeHistoryEntry: vi.fn(),
  removeAccountLike: vi.fn(),
  removeAccountComment: vi.fn(),
  resendVerification: vi.fn(),
  revokeSessions: vi.fn(),
  unfollowTopicCloud: vi.fn(),
  deleteAccount: vi.fn(),
  logout: vi.fn(),
  setUser: vi.fn(),
  navigate: vi.fn(),
  confirm: vi.fn(),
}))

let currentUser

const dashboardPayload = {
  counts: { following: 0, history: 1, comments: 0, likes: 0 },
  recent_history: [],
  followed_updates: [],
  security: { email_verified: true, password_set: true, last_login_at: '2026-07-20T10:00:00Z' },
}

const libraryPayload = {
  kind: 'all',
  total: 1,
  page: 1,
  page_size: 20,
  items: [{
    kind: 'history',
    id: '1',
    slug: 'read-me',
    title: '带封面的历史记录',
    summary: '摘要',
    content_type: 'post',
    cover_image: 'https://third-party.example.com/cover.png',
    occurred_at: '2026-07-20T10:00:00Z',
    available: true,
  }],
}

vi.mock('../src/api/user', () => ({
  fetchAccountDashboard: mocks.fetchAccountDashboard,
  fetchAccountLibrary: mocks.fetchAccountLibrary,
  fetchAccountExport: mocks.fetchAccountExport,
  updateMe: mocks.updateMe,
  uploadAvatar: mocks.uploadAvatar,
  removeAvatar: mocks.removeAvatar,
  changePassword: mocks.changePassword,
  clearCloudHistory: mocks.clearCloudHistory,
  removeHistoryEntry: mocks.removeHistoryEntry,
  removeAccountLike: mocks.removeAccountLike,
  removeAccountComment: mocks.removeAccountComment,
  resendVerification: mocks.resendVerification,
  revokeSessions: mocks.revokeSessions,
  unfollowTopicCloud: mocks.unfollowTopicCloud,
  deleteAccount: mocks.deleteAccount,
}))
vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({
    user: currentUser,
    loading: false,
    logout: mocks.logout,
    setUser: mocks.setUser,
    syncState: 'idle',
  }),
}))
vi.mock('../src/components/ui/ConfirmDialog', () => ({
  ConfirmProvider: ({ children }) => children,
  useConfirm: () => mocks.confirm,
}))
vi.mock('../src/components/Navbar', () => ({ default: () => null }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})

let AccountPage

async function renderPage(entry = '/account') {
  AccountPage = (await import('../src/pages/AccountPage')).default
  return render(<MemoryRouter initialEntries={[entry]}><AccountPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  currentUser = {
    email: 'u@example.com',
    nickname: 'Me',
    bio: '',
    avatar_url: 'https://third-party.example.com/avatar.png',
    email_verified: true,
    password_set: true,
    last_login_at: '2026-07-20T10:00:00Z',
  }
  mocks.fetchAccountDashboard.mockResolvedValue(dashboardPayload)
  mocks.fetchAccountLibrary.mockResolvedValue(libraryPayload)
  mocks.confirm.mockResolvedValue(true)
  window.sessionStorage.clear()
  window.scrollTo = vi.fn()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => cleanup())

const proxied = (url) => `/proxy-image?url=${encodeURIComponent(url)}`

describe('account media goes through the image policy', () => {
  it('proxies the sidebar identity avatar and falls back to initials when it breaks', async () => {
    await renderPage()

    const avatar = await waitFor(() => {
      const node = document.querySelector('.account-avatar img')
      expect(node).not.toBeNull()
      return node
    })
    expect(avatar.getAttribute('src')).toBe(proxied('https://third-party.example.com/avatar.png'))

    fireEvent.error(avatar)
    await waitFor(() => expect(document.querySelector('.account-avatar img')).toBeNull())
    expect(document.querySelector('.account-avatar')).toHaveTextContent('ME')
  })

  it('proxies library covers and swaps in the kind icon when the cover 404s', async () => {
    await renderPage('/account?tab=library&kind=all')

    expect(await screen.findByText('带封面的历史记录')).toBeInTheDocument()
    const cover = document.querySelector('.account-library-cover img')
    expect(cover.getAttribute('src')).toBe(proxied('https://third-party.example.com/cover.png'))

    fireEvent.error(cover)
    await waitFor(() => expect(document.querySelector('.account-library-cover img')).toBeNull())
    expect(document.querySelector('.account-library-cover svg')).not.toBeNull()
  })

  it('proxies the profile avatar preview', async () => {
    await renderPage('/account?tab=profile')

    const preview = await screen.findByAltText('头像预览')
    expect(preview.getAttribute('src')).toBe(proxied('https://third-party.example.com/avatar.png'))
  })
})

describe('unsaved-profile navigation guard', () => {
  async function makeProfileDirty() {
    await renderPage('/account?tab=profile')
    const nickname = await screen.findByLabelText('昵称')
    await userEvent.type(nickname, '改名')
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
  }

  it('asks before leaving and stays put when the reader cancels', async () => {
    mocks.confirm.mockResolvedValue(false)
    await makeProfileDirty()

    await userEvent.click(screen.getByRole('link', { name: '返回公开站' }))

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.navigate).not.toHaveBeenCalledWith('/')
  })

  it('never swallows site-wide links when the confirm flow throws', async () => {
    mocks.confirm.mockRejectedValue(new Error('confirm unavailable in this webview'))
    await makeProfileDirty()

    await userEvent.click(screen.getByRole('link', { name: '返回公开站' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/'))

    // 再次弄脏表单后，拦截器必须仍然可用：不能因为上一次抛错而卡在"已打开确认框"状态，
    // 也不能把后续链接永久吞掉。
    mocks.navigate.mockClear()
    await userEvent.type(screen.getByLabelText('昵称'), '再改')
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '订阅中心' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/feeds'))
  })
})
