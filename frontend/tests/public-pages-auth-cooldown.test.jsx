import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  requestLoginCode: vi.fn(() => Promise.resolve({ challenge_id: 'challenge-1', retry_after: 60 })),
  loginWithCode: vi.fn(),
  login: vi.fn(),
  requestPasswordReset: vi.fn(() => Promise.resolve({ challenge_id: 'reset-1', retry_after: 60 })),
  resetPassword: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({
    login: mocks.login,
    loginWithCode: mocks.loginWithCode,
    requestLoginCode: mocks.requestLoginCode,
    requestPasswordReset: mocks.requestPasswordReset,
    resetPassword: mocks.resetPassword,
  }),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mocks.navigate }
})
vi.mock('../src/components/TurnstileWidget', () => ({
  default: () => null,
  TURNSTILE_ENABLED: false,
}))

let LoginPage
let ResetPasswordPage

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  LoginPage = (await import('../src/pages/LoginPage')).default
  ResetPasswordPage = (await import('../src/pages/ResetPasswordPage')).default
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('verification code cooldown', () => {
  it('derives the login countdown from wall-clock time, not from tick count', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '验证码登录' }))
    await user.type(screen.getByLabelText('邮箱'), 'code@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))

    await waitFor(() => expect(mocks.requestLoginCode).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '60s 后重发' })).toBeDisabled()

    // 标签页被节流：真实时间走了 30 秒，但只有一次 interval 回调被执行。
    // 每秒自减的实现会显示 59s；基于时间戳推算的实现必须显示真实剩余时间。
    act(() => {
      vi.setSystemTime(Date.now() + 30000)
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: '29s 后重发' })).toBeDisabled()

    act(() => {
      vi.setSystemTime(Date.now() + 60000)
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeEnabled()
  })

  it('runs one interval per cooldown instead of rebuilding it every second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const setInterval = vi.spyOn(window, 'setInterval')
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '验证码登录' }))
    await user.type(screen.getByLabelText('邮箱'), 'code@example.com')
    await user.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '60s 后重发' })).toBeInTheDocument())

    const intervalsAfterStart = setInterval.mock.calls.length
    act(() => vi.advanceTimersByTime(10000))

    expect(screen.getByRole('button', { name: '50s 后重发' })).toBeInTheDocument()
    expect(setInterval.mock.calls.length).toBe(intervalsAfterStart)
    setInterval.mockRestore()
  })

  it('keeps the reset-password countdown accurate across a throttled tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(
      <MemoryRouter initialEntries={['/reset-password?email=reader%40example.com&challenge=old-challenge']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '60s 后重发' })).toBeDisabled()

    act(() => {
      vi.setSystemTime(Date.now() + 45000)
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByRole('button', { name: '14s 后重发' })).toBeDisabled()

    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByRole('button', { name: '重新发送' })).toBeEnabled()
  })
})
