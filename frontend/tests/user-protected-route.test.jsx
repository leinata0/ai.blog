import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  useUser: vi.fn(),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: mocks.useUser,
}))

let UserProtectedRoute

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  UserProtectedRoute = (await import('../src/components/UserProtectedRoute')).default
})

afterEach(() => cleanup())

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<UserProtectedRoute><div>account content</div></UserProtectedRoute>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UserProtectedRoute', () => {
  it('renders a stable loading state while the user session is being restored', () => {
    mocks.useUser.mockReturnValue({ loading: true, user: null })
    renderAt()

    expect(screen.getByRole('status')).toHaveTextContent('正在验证登录状态...')
    expect(screen.queryByText('account content')).not.toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('redirects to /login after loading when there is no user', () => {
    mocks.useUser.mockReturnValue({ loading: false, user: null })
    renderAt()
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders children after loading when the context has a user', () => {
    mocks.useUser.mockReturnValue({ loading: false, user: { email: 'u@example.com' } })
    renderAt()
    expect(screen.getByText('account content')).toBeInTheDocument()
  })
})
