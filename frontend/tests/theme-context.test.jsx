import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ThemeProvider, useTheme } from '../src/contexts/ThemeContext'

function Consumer() {
  const { dark, toggleTheme } = useTheme()
  return (
    <button type="button" onClick={toggleTheme}>
      {dark ? 'dark' : 'light'}
    </button>
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('keeps working when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError')
  })

  render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>,
  )

  const toggle = screen.getByRole('button', { name: 'light' })
  await userEvent.click(toggle)
  expect(screen.getByRole('button', { name: 'dark' })).toBeInTheDocument()
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
})
