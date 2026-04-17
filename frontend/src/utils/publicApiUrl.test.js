import { describe, expect, it, vi } from 'vitest'

describe('buildPublicApiUrl', () => {
  it('prefixes paths with VITE_API_BASE when configured', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE', 'https://api.example.com/')
    const { buildPublicApiUrl } = await import('./publicApiUrl')

    expect(buildPublicApiUrl('/feed.xml')).toBe('https://api.example.com/feed.xml')
  })

  it('returns the original path when VITE_API_BASE is empty', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_BASE', '')
    const { buildPublicApiUrl } = await import('./publicApiUrl')

    expect(buildPublicApiUrl('/api/feeds/daily.xml')).toBe('/api/feeds/daily.xml')
  })
})
