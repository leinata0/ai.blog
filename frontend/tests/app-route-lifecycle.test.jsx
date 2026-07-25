import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../src/pages/HomePage', async () => {
  const { Link } = await vi.importActual('react-router-dom')
  return {
    default: () => (
      <main data-testid="home-page">
        <h1>今日信号台</h1>
        <Link to="/login">进入登录</Link>
      </main>
    ),
  }
})
vi.mock('../src/pages/PostDetailPage', () => ({ default: () => <main><h1>文章</h1></main> }))
vi.mock('../src/pages/NotFoundPage', () => ({ default: () => <main><h1>未找到</h1></main> }))
vi.mock('../src/pages/LoginPage', () => ({ default: () => <main data-testid="login-page"><h1>登录</h1></main> }))
vi.mock('../src/pages/AdminLoginPage', () => ({ default: () => <main data-testid="admin-login-page"><h1>管理员登录</h1></main> }))
vi.mock('../src/components/CommandPalette', () => ({ default: () => <div data-testid="editorial-command-palette" /> }))

let App
let ADMIN_UNAUTHORIZED_EVENT

beforeEach(async () => {
  vi.resetModules()
  ;({ default: App } = await import('../src/App'))
  ;({ ADMIN_UNAUTHORIZED_EVENT } = await import('../src/api/client'))
})

afterEach(() => {
  cleanup()
  document.documentElement.dataset.surface = 'editorial'
  document.querySelector('meta[name="robots"][data-surface-managed]')?.remove()
})

describe('application route lifecycle', () => {
  it('unmounts the previous page before showing a lazy auth route', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(screen.getByTestId('home-page')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: '进入登录' }))
    await screen.findByTestId('login-page')

    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-ui="page-transition"]')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
    expect(document.querySelectorAll('main')).toHaveLength(1)
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.documentElement.dataset.surface).toBe('auth')
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')
    expect(screen.queryByTestId('editorial-command-palette')).not.toBeInTheDocument()
  })

  it('handles admin unauthorized events with replace navigation', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    const event = new CustomEvent(ADMIN_UNAUTHORIZED_EVENT, { cancelable: true })

    act(() => {
      window.dispatchEvent(event)
    })

    await waitFor(() => expect(screen.getByTestId('admin-login-page')).toBeInTheDocument())
    expect(event.defaultPrevented).toBe(true)
    expect(document.documentElement.dataset.surface).toBe('operations')
    expect(document.querySelectorAll('main')).toHaveLength(1)
  })
})
