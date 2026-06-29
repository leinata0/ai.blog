import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  updateMe: vi.fn(() => Promise.resolve({ email: 'u@example.com', nickname: 'New', bio: 'hi' })),
  changePassword: vi.fn(() => Promise.resolve()),
  fetchCloudTopics: vi.fn(() => Promise.resolve([])),
  fetchCloudHistory: vi.fn(() => Promise.resolve([])),
  fetchMyComments: vi.fn(() => Promise.resolve([{ id: 1, content: '我的评论', post_slug: 's', post_title: '某文章' }])),
  fetchMyLikes: vi.fn(() => Promise.resolve([{ post_slug: 's2', post_title: '点赞的文章' }])),
  uploadAvatar: vi.fn(() => Promise.resolve({ email: 'u@example.com', avatar_url: 'http://x/a.png' })),
  resendVerification: vi.fn(() => Promise.resolve()),
  deleteAccount: vi.fn(() => Promise.resolve()),
  logout: vi.fn(),
  setUser: vi.fn(),
  navigate: vi.fn(),
}))

let currentUser = { email: 'u@example.com', nickname: 'Me', bio: '', avatar_url: '', email_verified: true }

vi.mock('../src/api/user', () => ({
  updateMe: mocks.updateMe,
  changePassword: mocks.changePassword,
  fetchCloudTopics: mocks.fetchCloudTopics,
  fetchCloudHistory: mocks.fetchCloudHistory,
  fetchMyComments: mocks.fetchMyComments,
  fetchMyLikes: mocks.fetchMyLikes,
  uploadAvatar: mocks.uploadAvatar,
  resendVerification: mocks.resendVerification,
  deleteAccount: mocks.deleteAccount,
}))
vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({ user: currentUser, loading: false, logout: mocks.logout, setUser: mocks.setUser }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})
// Stub heavy layout children
vi.mock('../src/components/Navbar', () => ({ default: () => null }))
vi.mock('../src/components/Footer', () => ({ default: () => null }))
vi.mock('../src/components/BackToTop', () => ({ default: () => null }))

let AccountPage

async function renderPage() {
  AccountPage = (await import('../src/pages/AccountPage')).default
  return render(<MemoryRouter><AccountPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  currentUser = { email: 'u@example.com', nickname: 'Me', bio: '', avatar_url: '', email_verified: true }
})

afterEach(() => cleanup())

describe('AccountPage enhanced', () => {
  it('renders my comments and likes', async () => {
    await renderPage()
    await waitFor(() => expect(screen.getByText('我的评论')).toBeInTheDocument())
    expect(await screen.findByText('某文章')).toBeInTheDocument()
    expect(await screen.findByText('点赞的文章')).toBeInTheDocument()
  })

  it('uploads an avatar via the file input', async () => {
    await renderPage()
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]')
    await userEvent.upload(input, file)
    await waitFor(() => expect(mocks.uploadAvatar).toHaveBeenCalledWith(file))
    expect(mocks.setUser).toHaveBeenCalled()
  })

  it('saves bio through updateMe', async () => {
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(mocks.updateMe).toHaveBeenCalled())
    expect(mocks.updateMe.mock.calls[0][0]).toHaveProperty('bio')
  })

  it('shows verification banner and resends when unverified', async () => {
    currentUser = { ...currentUser, email_verified: false }
    await renderPage()
    expect(screen.getByText(/邮箱尚未验证/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重发验证邮件' }))
    await waitFor(() => expect(mocks.resendVerification).toHaveBeenCalled())
  })

  it('deletes account after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '注销账号' }))
    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalled())
    expect(mocks.logout).toHaveBeenCalled()
  })

  it('does not delete account when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderPage()
    await userEvent.click(screen.getByRole('button', { name: '注销账号' }))
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })
})
