import { afterEach, expect, it, vi } from 'vitest'

import { buildApiUrl, resolveApiBase } from '../src/api/base'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('uses same-origin api paths in deployed browsers even when a cross-origin api base is configured', () => {
  vi.stubEnv('VITE_API_BASE', 'https://ai-blog-hbur.onrender.com')

  const location = {
    origin: 'https://www.563118077.xyz',
    hostname: 'www.563118077.xyz',
    protocol: 'https:',
  }

  expect(resolveApiBase(location)).toBe('')
  expect(buildApiUrl('/api/posts', location)).toBe('/api/posts')
})

it('keeps the configured backend origin during localhost development', () => {
  vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:8000')

  const location = {
    origin: 'http://127.0.0.1:5173',
    hostname: '127.0.0.1',
    protocol: 'http:',
  }

  expect(resolveApiBase(location)).toBe('http://127.0.0.1:8000')
  expect(buildApiUrl('/api/posts', location)).toBe('http://127.0.0.1:8000/api/posts')
})

it('keeps same-origin configured api bases in deployed browsers', () => {
  vi.stubEnv('VITE_API_BASE', 'https://www.563118077.xyz')

  const location = {
    origin: 'https://www.563118077.xyz',
    hostname: 'www.563118077.xyz',
    protocol: 'https:',
  }

  expect(resolveApiBase(location)).toBe('https://www.563118077.xyz')
  expect(buildApiUrl('/api/posts', location)).toBe('https://www.563118077.xyz/api/posts')
})

it('ignores explicit cross-origin escape hatches in deployed browsers', () => {
  vi.stubEnv('VITE_API_BASE', 'https://api.example.com')
  vi.stubEnv('VITE_ALLOW_CROSS_ORIGIN_API', '1')

  const location = {
    origin: 'https://www.563118077.xyz',
    hostname: 'www.563118077.xyz',
    protocol: 'https:',
  }

  expect(resolveApiBase(location)).toBe('')
  expect(buildApiUrl('/api/posts', location)).toBe('/api/posts')
})
