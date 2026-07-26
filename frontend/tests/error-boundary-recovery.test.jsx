import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import ErrorBoundary, { APP_ERROR_EVENT, isChunkLoadError } from '../src/components/ErrorBoundary'

function Boom({ shouldThrow, message = 'boom' }) {
  if (shouldThrow) throw new Error(message)
  return <div data-testid="ok">healthy route</div>
}

let consoleError

beforeEach(() => {
  window.sessionStorage.clear()
  // React logs the caught error itself; keep the test output readable.
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleError.mockRestore()
})

it('recovers when resetKeys change so one broken route does not poison the whole app', () => {
  const { rerender } = render(
    <ErrorBoundary resetKeys={['/broken']}>
      <Boom shouldThrow />
    </ErrorBoundary>,
  )

  expect(screen.getByText('页面出了点问题')).toBeInTheDocument()

  // Navigating elsewhere must clear the boundary instead of keeping hasError forever.
  rerender(
    <ErrorBoundary resetKeys={['/healthy']}>
      <Boom shouldThrow={false} />
    </ErrorBoundary>,
  )

  expect(screen.getByTestId('ok')).toBeInTheDocument()
  expect(screen.queryByText('页面出了点问题')).toBeNull()
})

it('reports caught errors instead of swallowing them', () => {
  const listener = vi.fn()
  window.addEventListener(APP_ERROR_EVENT, listener)

  render(
    <ErrorBoundary>
      <Boom shouldThrow message="unexpected failure" />
    </ErrorBoundary>,
  )

  window.removeEventListener(APP_ERROR_EVENT, listener)
  expect(listener).toHaveBeenCalled()
  expect(listener.mock.calls[0][0].detail.message).toContain('unexpected failure')
  expect(consoleError).toHaveBeenCalled()
})

it('never shows the raw English error text to readers', () => {
  const raw = 'Failed to fetch dynamically imported module: https://site/assets/Archive-abc123.js'
  render(
    <ErrorBoundary>
      <Boom shouldThrow message={raw} />
    </ErrorBoundary>,
  )

  expect(screen.queryByText(new RegExp('Failed to fetch', 'i'))).toBeNull()
  expect(screen.getByText(/站点刚刚更新过/)).toBeInTheDocument()
})

it('recognises the wordings browsers use for a chunk that disappeared after a redeploy', () => {
  expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/a.js'))).toBe(true)
  expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
  expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true)
  expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
})

it('auto-reloads once for a stale chunk and then stops instead of looping', () => {
  const reload = vi.fn()
  const originalLocation = window.location
  delete window.location
  window.location = { ...originalLocation, reload }

  try {
    render(
      <ErrorBoundary>
        <Boom shouldThrow message="Failed to fetch dynamically imported module: /assets/a.js" />
      </ErrorBoundary>,
    )
    expect(reload).toHaveBeenCalledTimes(1)

    cleanup()
    render(
      <ErrorBoundary>
        <Boom shouldThrow message="Failed to fetch dynamically imported module: /assets/a.js" />
      </ErrorBoundary>,
    )
    // Cooldown flag is set, so a genuinely broken deploy can't turn into a reload loop.
    expect(reload).toHaveBeenCalledTimes(1)
  } finally {
    window.location = originalLocation
  }
})
