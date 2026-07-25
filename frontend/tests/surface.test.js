import { afterEach, describe, expect, it } from 'vitest'
import {
  applyDocumentSurface,
  getSurfaceForPath,
  getThemeColor,
} from '../src/utils/surface'

afterEach(() => {
  document.documentElement.dataset.surface = 'editorial'
  document.documentElement.dataset.theme = 'light'
  document.querySelector('meta[name="robots"][data-surface-managed]')?.remove()
})

describe('semantic surfaces', () => {
  it.each([
    ['/', 'editorial'],
    ['/search', 'editorial'],
    ['/login', 'auth'],
    ['/account/', 'auth'],
    ['/admin/login', 'operations'],
    ['/admin/dashboard', 'operations'],
  ])('maps %s to %s', (pathname, expected) => {
    expect(getSurfaceForPath(pathname)).toBe(expected)
  })

  it('updates theme color and private robots metadata together', () => {
    const themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    document.head.appendChild(themeMeta)
    document.documentElement.dataset.theme = 'dark'

    applyDocumentSurface('/login')
    expect(themeMeta.content).toBe(getThemeColor('auth', true))
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow')

    applyDocumentSurface('/discover')
    expect(document.querySelector('meta[name="robots"][data-surface-managed]')).toBeNull()
    themeMeta.remove()
  })
})
