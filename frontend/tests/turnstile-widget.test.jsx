import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let TurnstileWidget

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  // VITE_TURNSTILE_SITE_KEY is unset in the test env.
  TurnstileWidget = (await import('../src/components/TurnstileWidget')).default
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete window.turnstile
  document.querySelectorAll('script[src*="challenges.cloudflare.com/turnstile"]').forEach((script) => script.remove())
})

describe('TurnstileWidget', () => {
  it('renders nothing when the site key is not configured', () => {
    const onVerify = vi.fn()
    const { container } = render(<TurnstileWidget onVerify={onVerify} />)
    expect(container.firstChild).toBeNull()
  })

  it('exports TURNSTILE_ENABLED=false when unconfigured', async () => {
    const mod = await import('../src/components/TurnstileWidget')
    expect(mod.TURNSTILE_ENABLED).toBe(false)
  })

  it('removes a failed script and retries without a hard refresh', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
    vi.resetModules()
    TurnstileWidget = (await import('../src/components/TurnstileWidget')).default

    render(<TurnstileWidget onVerify={vi.fn()} />)
    const failedScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
    expect(failedScript).toBeInTheDocument()

    fireEvent.error(failedScript)
    expect(await screen.findByRole('alert')).toHaveTextContent('验证服务加载失败')
    expect(failedScript).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    const retryScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
    expect(retryScript).toBeInTheDocument()
    expect(retryScript).not.toBe(failedScript)

    window.turnstile = {
      remove: vi.fn(),
      render: vi.fn(() => 'widget-id'),
    }
    fireEvent.load(retryScript)
    await waitFor(() => expect(window.turnstile.render).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('can load again after leaving the page following a script failure', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
    vi.resetModules()
    TurnstileWidget = (await import('../src/components/TurnstileWidget')).default

    const firstRender = render(<TurnstileWidget onVerify={vi.fn()} />)
    const failedScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
    fireEvent.error(failedScript)
    await screen.findByRole('alert')
    firstRender.unmount()

    render(<TurnstileWidget onVerify={vi.fn()} />)
    const nextScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')
    expect(nextScript).toBeInTheDocument()
    expect(nextScript).not.toBe(failedScript)
  })
})
