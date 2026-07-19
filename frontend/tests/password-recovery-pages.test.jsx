import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({
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

let ForgotPasswordPage
let ResetPasswordPage

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  mocks.requestPasswordReset.mockResolvedValue({ challenge_id: 'reset-challenge' })
  mocks.resetPassword.mockResolvedValue({ email: 'reader@example.com' })
  ForgotPasswordPage = (await import('../src/pages/ForgotPasswordPage')).default
  ResetPasswordPage = (await import('../src/pages/ResetPasswordPage')).default
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('password recovery pages', () => {
  it('requests a reset code and carries the email and challenge into the reset route', async () => {
    render(<MemoryRouter><ForgotPasswordPage /></MemoryRouter>)
    await userEvent.type(screen.getByLabelText('邮箱'), 'reader+news@example.com')
    await userEvent.click(screen.getByRole('button', { name: '发送重置验证码' }))

    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: 'reader+news@example.com',
      turnstile_token: '',
    }))
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/reset-password?email=reader%2Bnews%40example.com&challenge=reset-challenge',
    )
  })

  it('confirms the code and new password, then enters the account center', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?email=reader%40example.com&challenge=reset-challenge']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )

    await userEvent.type(screen.getByLabelText('验证码'), '654321')
    await userEvent.type(screen.getByLabelText('新密码'), 'newsecret123')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'newsecret123')
    await userEvent.click(screen.getByRole('button', { name: '设置新密码并登录' }))

    await waitFor(() => expect(mocks.resetPassword).toHaveBeenCalledWith({
      email: 'reader@example.com',
      challenge_id: 'reset-challenge',
      code: '654321',
      new_password: 'newsecret123',
      turnstile_token: '',
    }))
    expect(mocks.navigate).toHaveBeenCalledWith('/account')
  })

  it('rejects mismatched passwords without consuming the reset challenge', async () => {
    render(
      <MemoryRouter initialEntries={['/reset-password?email=reader%40example.com&challenge=reset-challenge']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )

    await userEvent.type(screen.getByLabelText('验证码'), '654321')
    await userEvent.type(screen.getByLabelText('新密码'), 'newsecret123')
    await userEvent.type(screen.getByLabelText('确认新密码'), 'different123')
    await userEvent.click(screen.getByRole('button', { name: '设置新密码并登录' }))

    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致')
    expect(mocks.resetPassword).not.toHaveBeenCalled()
  })

  it('resends a reset code and updates the challenge in the URL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <MemoryRouter initialEntries={['/reset-password?email=reader%40example.com&challenge=old-challenge']}>
        <ResetPasswordPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '60s 后重发' })).toBeDisabled()
    act(() => vi.advanceTimersByTime(60000))
    await user.click(screen.getByRole('button', { name: '重新发送' }))

    await waitFor(() => expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: 'reader@example.com',
      turnstile_token: '',
    }))
    expect(screen.getByText('新的验证码已发送')).toBeInTheDocument()
  })
})
