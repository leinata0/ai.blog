import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  fetchAccountDashboard: vi.fn(),
  fetchAccountLibrary: vi.fn(),
  fetchAccountExport: vi.fn(() => Promise.resolve({ profile: { email: 'u@example.com' } })),
  updateMe: vi.fn((payload) => Promise.resolve({ email: 'u@example.com', nickname: payload.nickname, bio: payload.bio, email_verified: true, password_set: true })),
  uploadAvatar: vi.fn(() => Promise.resolve({ email: 'u@example.com', nickname: 'Me', bio: '', avatar_url: '/avatar.png', email_verified: true, password_set: true })),
  removeAvatar: vi.fn(),
  changePassword: vi.fn(),
  clearCloudHistory: vi.fn(),
  removeHistoryEntry: vi.fn(),
  removeAccountLike: vi.fn(() => Promise.resolve({ removed: true })),
  removeAccountComment: vi.fn(),
  resendVerification: vi.fn(),
  revokeSessions: vi.fn(),
  unfollowTopicCloud: vi.fn(),
  deleteAccount: vi.fn(() => Promise.resolve()),
  logout: vi.fn(),
  setUser: vi.fn(),
  revokeAllSessions: vi.fn(() => Promise.resolve()),
  retrySync: vi.fn(),
}))

let currentUser

const dashboardPayload = {
  counts: { following: 1, history: 1, comments: 1, likes: 1 },
  recent_history: [{
    kind: 'history', id: 'recent', slug: 'recent', title: '最近阅读的 AI 文章', summary: '摘要',
    content_type: 'post', occurred_at: '2026-07-20T10:00:00Z', available: true,
  }],
  followed_updates: [{
    topic_key: 'agents', display_title: '智能体', followed_at: '2026-07-01T10:00:00Z',
    latest_post: { slug: 'agent-news', title: '智能体最新进展', published_at: '2026-07-21T10:00:00Z' },
  }],
  security: { email_verified: true, password_set: true, last_login_at: '2026-07-20T10:00:00Z' },
}

const libraryPayload = {
  kind: 'all',
  total: 2,
  page: 1,
  page_size: 20,
  items: [
    { kind: 'likes', id: '2', slug: 'liked', title: '点赞的文章', summary: '点赞摘要', content_type: 'post', occurred_at: '2026-07-20T10:00:00Z', available: true },
    { kind: 'comments', id: '1', slug: 'commented', title: '评论的文章', comment_content: '我的评论', content_type: 'post', occurred_at: '2026-07-19T10:00:00Z', available: true },
  ],
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
    revokeAllSessions: mocks.revokeAllSessions,
    retrySync: mocks.retrySync,
    syncState: 'idle',
  }),
}))
vi.mock('../src/components/Navbar', () => ({ default: () => null }))

let AccountPage

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

async function renderPage(entry = '/account') {
  AccountPage = (await import('../src/pages/AccountPage')).default
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="*" element={<><AccountPage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  currentUser = {
    email: 'u@example.com', nickname: 'Me', bio: '', avatar_url: '', email_verified: true,
    password_set: true, created_at: '2026-01-01T00:00:00Z', last_login_at: '2026-07-20T10:00:00Z',
  }
  mocks.fetchAccountDashboard.mockResolvedValue(dashboardPayload)
  mocks.fetchAccountLibrary.mockResolvedValue(libraryPayload)
  window.sessionStorage.clear()
  window.scrollTo = vi.fn()
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => cleanup())

describe('Account signal hub', () => {
  it('renders a single landmark and canonical overview URL with dashboard data', async () => {
    await renderPage('/account?tab=invalid&page=-2')
    expect(await screen.findByText('最近阅读的 AI 文章')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/account?tab=overview'))
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('deep-links to the unified library and synchronizes search into the URL', async () => {
    await renderPage('/account?tab=library&kind=likes')
    expect(await screen.findByText('点赞的文章')).toBeInTheDocument()
    expect(mocks.fetchAccountLibrary).toHaveBeenCalledWith(expect.objectContaining({ kind: 'likes', page: 1 }))

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索个人资料库' }), '智能体')
    await userEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=%E6%99%BA%E8%83%BD%E4%BD%93'))
  })

  it('opens the account command palette with Ctrl/Cmd+K and supports section navigation', async () => {
    await renderPage()
    await userEvent.keyboard('{Control>}k{/Control}')
    const dialog = screen.getByRole('dialog', { name: '个人中心快速跳转与搜索' })
    expect(within(dialog).getByRole('searchbox')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('tab=library'))
  })

  it('closes the command palette with Escape and restores focus to its trigger', async () => {
    await renderPage()
    const trigger = await screen.findByRole('button', { name: /快速跳转与搜索/ })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '个人中心快速跳转与搜索' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '个人中心快速跳转与搜索' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('previews an avatar and saves profile changes through the branded form', async () => {
    await renderPage('/account?tab=profile')
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' })
    await userEvent.upload(screen.getByLabelText('选择图片'), file)
    await userEvent.clear(screen.getByLabelText('昵称'))
    await userEvent.type(screen.getByLabelText('昵称'), 'New Me')
    await userEvent.click(screen.getByRole('button', { name: '保存身份资料' }))
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalledWith({ nickname: 'New Me', bio: '' }))
    expect(mocks.uploadAvatar).toHaveBeenCalledWith(file)
  })

  it('removes a library item only after the accessible confirmation dialog', async () => {
    await renderPage('/account?tab=library&kind=all')
    expect(await screen.findByText('点赞的文章')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消点赞：点赞的文章' }))
    const dialog = screen.getByRole('dialog', { name: '取消点赞' })
    await userEvent.click(within(dialog).getByRole('button', { name: '取消点赞' }))
    await waitFor(() => expect(mocks.removeAccountLike).toHaveBeenCalledWith('liked'))
    expect(screen.queryByText('点赞的文章')).not.toBeInTheDocument()
  })

  it('rolls an optimistic library removal back when the request fails', async () => {
    mocks.removeAccountLike.mockRejectedValueOnce(new Error('网络故障'))
    await renderPage('/account?tab=library&kind=all')
    expect(await screen.findByText('点赞的文章')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消点赞：点赞的文章' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: '取消点赞' })).getByRole('button', { name: '取消点赞' }))
    expect(await screen.findByText('点赞的文章')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('列表已恢复，请重试')
  })

  it('refreshes an all-items library after clearing history without erasing other totals', async () => {
    mocks.fetchAccountLibrary
      .mockResolvedValueOnce({
        ...libraryPayload,
        total: 3,
        items: [
          { kind: 'history', id: '3', slug: 'read', title: '读过的文章', content_type: 'post', occurred_at: '2026-07-18T10:00:00Z', available: true },
          ...libraryPayload.items,
        ],
      })
      .mockResolvedValueOnce(libraryPayload)
    await renderPage('/account?tab=library&kind=all')
    expect(await screen.findByText('读过的文章')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清空历史' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: '清空阅读历史' })).getByRole('button', { name: '清空历史' }))
    await waitFor(() => expect(mocks.clearCloudHistory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('2 条记录')).toBeInTheDocument()
    expect(screen.queryByText('读过的文章')).not.toBeInTheDocument()
    expect(screen.getByText('点赞的文章')).toBeInTheDocument()
  })

  it('requires typed confirmation before permanently deleting the account', async () => {
    await renderPage('/account?tab=security')
    await userEvent.click(screen.getByRole('button', { name: '永久注销账号' }))
    const dialog = screen.getByRole('dialog', { name: '永久注销账号' })
    const confirmButton = within(dialog).getByRole('button', { name: '永久注销' })
    expect(confirmButton).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/输入“注销账号”继续/), '注销账号')
    await userEvent.click(confirmButton)
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledTimes(1))
    expect(mocks.logout).toHaveBeenCalled()
  })

  it('revokes all sessions through the shared dialog and routes to the reasoned login URL', async () => {
    await renderPage('/account?tab=security')
    await userEvent.click(screen.getByRole('button', { name: '退出全部设备' }))
    const dialog = screen.getByRole('dialog', { name: '退出全部设备' })
    await userEvent.click(within(dialog).getByRole('button', { name: '退出全部设备' }))
    await waitFor(() => expect(mocks.revokeAllSessions).toHaveBeenCalledTimes(1))
    // react-router v7 dispatches location updates inside `React.startTransition`,
    // so the redirect commits on a Scheduler task rather than in the microtask
    // that calls `navigate()`. Waiting on the mock only proves the request fired;
    // the URL has to be awaited separately or the assertion races the commit.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?reason=sessions-revoked'))
  })
})
