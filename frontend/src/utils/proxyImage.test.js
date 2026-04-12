import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('VITE_IMAGE_PROXY_BASE', 'https://api.example.com/proxy-image')
vi.stubEnv('VITE_API_BASE', 'https://api.example.com')

const { proxyImageUrl } = await import('./proxyImage')

describe('proxyImageUrl', () => {
  it('returns local API image urls directly', () => {
    expect(proxyImageUrl('https://api.example.com/uploads/test.jpg')).toBe('https://api.example.com/uploads/test.jpg')
  })

  it('proxies external urls', () => {
    expect(proxyImageUrl('https://example.com/test.jpg')).toBe(
      'https://api.example.com/proxy-image?url=https%3A%2F%2Fexample.com%2Ftest.jpg'
    )
  })
})
