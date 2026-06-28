import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  getUserToken: vi.fn(),
  isUserTokenExpired: vi.fn(),
}))

vi.mock('../src/api/userAuth', () => ({
  getUserToken: mocks.getUserToken,
  isUserTokenExpired: mocks.isUserTokenExpired,
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
  it('redirects to /login when there is no valid user token', () => {
    mocks.getUserToken.mockReturnValue(null)
    mocks.isUserTokenExpired.mockReturnValue(true)
    renderAt()
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('renders children when a valid user token exists', () => {
    mocks.getUserToken.mockReturnValue('tok')
    mocks.isUserTokenExpired.mockReturnValue(false)
    renderAt()
    expect(screen.getByText('account content')).toBeInTheDocument()
  })
})
