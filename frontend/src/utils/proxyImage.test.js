import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('VITE_IMAGE_PROXY_BASE', 'https://api.example.com/proxy-image')
vi.stubEnv('VITE_API_BASE', 'https://api.example.com')
vi.stubEnv('VITE_IMAGE_DIRECT_BASES', 'https://img.example.com,https://cdn.example.com')

const { proxyImageUrl } = await import('./proxyImage')

describe('proxyImageUrl', () => {
  it('keeps relative upload urls direct so Vercel rewrites can handle them', () => {
    expect(proxyImageUrl('/uploads/test.jpg')).toBe('/uploads/test.jpg')
  })

  it('returns local API image urls directly', () => {
    expect(proxyImageUrl('https://api.example.com/uploads/test.jpg')).toBe('https://api.example.com/uploads/test.jpg')
  })

  it('proxies external urls', () => {
    expect(proxyImageUrl('https://example.com/test.jpg')).toBe(
      'https://api.example.com/proxy-image?url=https%3A%2F%2Fexample.com%2Ftest.jpg'
    )
  })

  it('keeps trusted image bases direct', () => {
    expect(proxyImageUrl('https://img.example.com/test.jpg')).toBe('https://img.example.com/test.jpg')
  })
})
