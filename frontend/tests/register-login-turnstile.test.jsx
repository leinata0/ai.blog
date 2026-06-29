import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  login: vi.fn(() => Promise.resolve({ email: 'u@example.com' })),
  register: vi.fn(() => Promise.resolve({ email: 'u@example.com' })),
  navigate: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({ login: mocks.login, register: mocks.register }),
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

afterEach(() => cleanup())

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
})
