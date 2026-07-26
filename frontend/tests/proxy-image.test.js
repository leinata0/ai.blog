import { beforeEach, describe, expect, it, vi } from 'vitest'

const DIRECT_BASE = 'https://img.563118077.xyz'

let proxyImageUrl

beforeEach(async () => {
  vi.resetModules()
  ;({ proxyImageUrl } = await import('../src/utils/proxyImage'))
})

function proxied(url) {
  return `/proxy-image?url=${encodeURIComponent(url)}`
}

describe('proxyImageUrl', () => {
  it('passes through inline data and blob sources', () => {
    expect(proxyImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(proxyImageUrl('blob:http://localhost/abc')).toBe('blob:http://localhost/abc')
    expect(proxyImageUrl('')).toBe('')
    expect(proxyImageUrl(null)).toBe('')
  })

  it('keeps same-origin relative paths untouched', () => {
    expect(proxyImageUrl('/uploads/cover.png')).toBe('/uploads/cover.png')
  })

  it('proxies a protocol-relative URL instead of returning it verbatim', () => {
    // "//evil.com/x.png" satisfies startsWith('/') but the browser resolves it to a
    // cross-site direct load, leaking the visitor IP and skipping every backend guard.
    const result = proxyImageUrl('//evil.com/x.png')
    expect(result).not.toBe('//evil.com/x.png')
    expect(result.startsWith('/proxy-image?url=')).toBe(true)
    expect(decodeURIComponent(result.split('url=')[1])).toContain('evil.com/x.png')
  })

  it('does not treat a look-alike host as an allow-listed direct base', () => {
    const lookAlike = `${DIRECT_BASE}.attacker.com/x.png`
    expect(proxyImageUrl(lookAlike)).toBe(proxied(lookAlike))

    const suffixHost = 'https://evil-img.563118077.xyz/x.png'
    expect(proxyImageUrl(suffixHost)).toBe(proxied(suffixHost))
  })

  it('still allows the real direct base and its sub-paths', () => {
    expect(proxyImageUrl(`${DIRECT_BASE}/covers/a.png`)).toBe(`${DIRECT_BASE}/covers/a.png`)
    expect(proxyImageUrl(`${DIRECT_BASE}/a.png?v=2`)).toBe(`${DIRECT_BASE}/a.png?v=2`)
  })

  it('proxies ordinary third-party images', () => {
    expect(proxyImageUrl('https://example.com/markdown.jpg')).toBe(proxied('https://example.com/markdown.jpg'))
  })

  it('rejects non-http(s) schemes outright', () => {
    expect(proxyImageUrl('javascript:alert(1)')).toBe('')
    expect(proxyImageUrl('file:///etc/passwd')).toBe('')
  })
})
