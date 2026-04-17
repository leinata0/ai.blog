import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import AdminLoginPage from '../src/pages/AdminLoginPage'

const mocks = vi.hoisted(() => ({
  adminLogin: vi.fn(),
  navigate: vi.fn(),
  setToken: vi.fn(),
}))

vi.mock('../src/api/admin', () => ({
  adminLogin: mocks.adminLogin,
}))

vi.mock('../src/api/auth', () => ({
  setToken: mocks.setToken,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

it('shows a credential error for invalid username or password', async () => {
  mocks.adminLogin.mockRejectedValueOnce(new Error('{"detail":"Invalid credentials"}'))

  render(
    <MemoryRouter>
      <AdminLoginPage />
    </MemoryRouter>,
  )

  await userEvent.type(screen.getByPlaceholderText('admin'), 'admin')
  await userEvent.type(screen.getByLabelText('密码'), 'bad-password')
  await userEvent.click(screen.getByRole('button', { name: '登录' }))

  expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument()
})

it('shows a service error for network failures', async () => {
  mocks.adminLogin.mockRejectedValueOnce(new Error('Failed to fetch'))

  render(
    <MemoryRouter>
      <AdminLoginPage />
    </MemoryRouter>,
  )

  await userEvent.type(screen.getByPlaceholderText('admin'), 'admin')
  await userEvent.type(screen.getByLabelText('密码'), 'secret')
  await userEvent.click(screen.getByRole('button', { name: '登录' }))

  expect(await screen.findByText('登录失败，后台服务暂时不可用，请稍后重试。')).toBeInTheDocument()
})
