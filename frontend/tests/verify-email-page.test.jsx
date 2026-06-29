import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  verifyEmail: vi.fn(),
  refresh: vi.fn(() => Promise.resolve()),
}))

vi.mock('../src/api/user', () => ({ verifyEmail: mocks.verifyEmail }))
vi.mock('../src/contexts/UserContext', () => ({ useUser: () => ({ refresh: mocks.refresh }) }))

let VerifyEmailPage

async function renderAt(search) {
  VerifyEmailPage = (await import('../src/pages/VerifyEmailPage')).default
  return render(
    <MemoryRouter initialEntries={[`/verify-email${search}`]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

afterEach(() => cleanup())

describe('VerifyEmailPage', () => {
  it('shows success when the token verifies', async () => {
    mocks.verifyEmail.mockResolvedValue({ email_verified: true })
    await renderAt('?token=good-token')
    await waitFor(() => expect(screen.getByText('验证成功')).toBeInTheDocument())
    expect(mocks.verifyEmail).toHaveBeenCalledWith('good-token')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows failure when the token is invalid', async () => {
    mocks.verifyEmail.mockRejectedValue(new Error('验证链接无效或已过期'))
    await renderAt('?token=bad')
    await waitFor(() => expect(screen.getByText('验证失败')).toBeInTheDocument())
  })

  it('shows an error when no token is present', async () => {
    await renderAt('')
    await waitFor(() => expect(screen.getByText('验证失败')).toBeInTheDocument())
    expect(mocks.verifyEmail).not.toHaveBeenCalled()
  })
})
