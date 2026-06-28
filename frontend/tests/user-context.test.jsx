import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  mergeTopicsCloud: vi.fn(() => Promise.resolve([])),
  mergeHistoryCloud: vi.fn(() => Promise.resolve([])),
  getUserToken: vi.fn(),
  setUserToken: vi.fn(),
  clearUserToken: vi.fn(),
  isUserTokenExpired: vi.fn(),
  getFollowedTopics: vi.fn(() => []),
  getReadingHistory: vi.fn(() => []),
}))

vi.mock('../src/api/user', () => ({
  fetchMe: mocks.fetchMe,
  loginUser: mocks.loginUser,
  registerUser: mocks.registerUser,
  mergeTopicsCloud: mocks.mergeTopicsCloud,
  mergeHistoryCloud: mocks.mergeHistoryCloud,
}))
vi.mock('../src/api/userAuth', () => ({
  getUserToken: mocks.getUserToken,
  setUserToken: mocks.setUserToken,
  clearUserToken: mocks.clearUserToken,
  isUserTokenExpired: mocks.isUserTokenExpired,
}))
vi.mock('../src/utils/topicRetention', () => ({
  getFollowedTopics: mocks.getFollowedTopics,
  getReadingHistory: mocks.getReadingHistory,
}))

let UserProvider
let useUser

function Consumer() {
  const { user, loading, login, logout } = useUser()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user ? user.email : 'none'}</span>
      <button onClick={() => login({ email: 'u@example.com', password: 'secret123' })}>login</button>
      <button onClick={logout}>logout</button>
    </div>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  ;({ UserProvider, useUser } = await import('../src/contexts/UserContext'))
})

afterEach(() => {
  cleanup()
})

describe('UserContext', () => {
  it('initializes to no user when there is no token', async () => {
    mocks.getUserToken.mockReturnValue(null)
    mocks.isUserTokenExpired.mockReturnValue(true)

    render(<UserProvider><Consumer /></UserProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(mocks.clearUserToken).toHaveBeenCalled()
  })

  it('login sets the token, the user, and triggers local→cloud merge', async () => {
    mocks.getUserToken.mockReturnValue(null)
    mocks.isUserTokenExpired.mockReturnValue(true)
    mocks.loginUser.mockResolvedValue({ access_token: 'tok', user: { email: 'u@example.com' } })
    mocks.getFollowedTopics.mockReturnValue([{ topic_key: 'llm', display_title: '大模型' }])

    render(<UserProvider><Consumer /></UserProvider>)
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'))

    await userEvent.click(screen.getByText('login'))
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('u@example.com'))
    expect(mocks.setUserToken).toHaveBeenCalledWith('tok')
    expect(mocks.mergeTopicsCloud).toHaveBeenCalled()
  })

  it('logout clears the token and user', async () => {
    mocks.getUserToken.mockReturnValue('tok')
    mocks.isUserTokenExpired.mockReturnValue(false)
    mocks.fetchMe.mockResolvedValue({ email: 'u@example.com' })

    render(<UserProvider><Consumer /></UserProvider>)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('u@example.com'))

    await userEvent.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'))
    expect(mocks.clearUserToken).toHaveBeenCalled()
  })
})
