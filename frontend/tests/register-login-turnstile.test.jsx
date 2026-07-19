import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve({ email: 'u@example.com' })),
  loginWithCode: vi.fn(() => Promise.resolve({ email: 'u@example.com' })),
  requestLoginCode: vi.fn(() => Promise.resolve({ challenge_id: 'challenge-1', retry_after: 60 })),
  register: vi.fn(() => Promise.resolve({ email: 'u@example.com' })),
  navigate: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({
    login: mocks.login,
    loginWithCode: mocks.loginWithCode,
    requestLoginCode: mocks.requestLoginCode,
    register: mocks.register,
  }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})
// Site key is unset in tests → widget renders nothing, no gating.
vi.mock('../src/components/TurnstileWidget', () => ({
  default: () => null,
  TURNSTILE_ENABLED: false,
}))

let LoginPage
let RegisterPage

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  LoginPage = (await import('../src/pages/LoginPage')).default
  RegisterPage = (await import('../src/pages/RegisterPage')).default
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('auth pages with Turnstile disabled', () => {
  it('login submits with an (empty) turnstile_token field present', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'u@example.com')
    await userEvent.type(screen.getByPlaceholderText('请输入密码'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(mocks.login).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'u@example.com', password: 'secret123', turnstile_token: '' }),
    )
  })

  it('register submits with turnstile_token field present', async () => {
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'new@example.com')
    await userEvent.type(screen.getByPlaceholderText('至少 8 位'), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: '注册' }))

    expect(mocks.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com', turnstile_token: '' }),
    )
  })

  it('requests a code, counts down, and logs in with the returned challenge', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '验证码登录' }))
    await user.type(screen.getByLabelText('邮箱'), 'code@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => expect(mocks.requestLoginCode).toHaveBeenCalledWith({
      email: 'code@example.com',
      turnstile_token: '',
    }))
    expect(screen.getByRole('status')).toHaveTextContent('验证码已发送')
    expect(screen.getByRole('button', { name: '60s 后重发' })).toBeDisabled()

    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('button', { name: '59s 后重发' })).toBeDisabled()

    await user.type(screen.getByLabelText('邮箱验证码'), '123456')
    await user.click(screen.getByRole('button', { name: '使用验证码登录' }))

    await waitFor(() => expect(mocks.loginWithCode).toHaveBeenCalledWith({
      email: 'code@example.com',
      challenge_id: 'challenge-1',
      code: '123456',
    }))
    expect(mocks.navigate).toHaveBeenCalledWith('/account')
    vi.useRealTimers()
  })

  it('shows an expired-code error and does not navigate', async () => {
    mocks.loginWithCode.mockRejectedValueOnce(new Error('验证码已过期，请重新发送'))
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await userEvent.click(screen.getByRole('button', { name: '验证码登录' }))
    await userEvent.type(screen.getByLabelText('邮箱'), 'code@example.com')
    await userEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await screen.findByRole('status')
    await userEvent.type(screen.getByLabelText('邮箱验证码'), '123456')
    await userEvent.click(screen.getByRole('button', { name: '使用验证码登录' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('验证码已过期，请重新发送')
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
