import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let TurnstileWidget

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()
  // VITE_TURNSTILE_SITE_KEY is unset in the test env.
  TurnstileWidget = (await import('../src/components/TurnstileWidget')).default
})

afterEach(() => cleanup())

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
})
