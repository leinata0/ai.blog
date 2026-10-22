import { afterEach, describe, expect, it } from 'vitest'
import {
  applyDocumentSurface,
  applyDocumentNewsStyle,
  applyDocumentTheme,
  getSurfaceForPath,
  getThemeColor,
} from '../src/utils/surface'

afterEach(() => {
  document.documentElement.dataset.surface = 'editorial'
  document.documentElement.dataset.theme = 'light'
  delete document.documentElement.dataset.newsStyle
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

  it('uses the tech color without overwriting the paper theme preference', () => {
    const themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    document.head.appendChild(themeMeta)
    applyDocumentSurface('/')
    applyDocumentTheme(false)

    applyDocumentNewsStyle('tech')
    expect(themeMeta.content).toBe('#eee9df')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyDocumentTheme(true)
    expect(themeMeta.content).toBe('#eee9df')
    applyDocumentNewsStyle('paper')
    expect(themeMeta.content).toBe(getThemeColor('editorial', true))
    themeMeta.remove()
  })

  it('keeps authentication and operations colors independent of news style', () => {
    const themeMeta = document.createElement('meta')
    themeMeta.name = 'theme-color'
    document.head.appendChild(themeMeta)
    applyDocumentTheme(false)
    applyDocumentNewsStyle('tech')

    applyDocumentSurface('/login')
    expect(themeMeta.content).toBe(getThemeColor('auth', false))
    applyDocumentSurface('/admin/login')
    expect(themeMeta.content).toBe(getThemeColor('operations', false))
    applyDocumentSurface('/')
    expect(themeMeta.content).toBe('#eee9df')
    themeMeta.remove()
  })
})
