import { afterEach, expect, it, vi } from 'vitest'

import { buildApiUrl, resolveApiBase } from '../src/api/base'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('prefers same-origin routes in deployed browsers when the configured API is cross-origin', () => {
  vi.stubEnv('VITE_API_BASE', 'https://ai-blog-hbur.onrender.com')

  const location = {
    origin: 'https://www.563118077.xyz',
    hostname: 'www.563118077.xyz',
  }

  expect(resolveApiBase(location)).toBe('')
  expect(buildApiUrl('/api/posts', location)).toBe('/api/posts')
})

it('keeps the configured backend origin during localhost development', () => {
  vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:8000')

  const location = {
    origin: 'http://127.0.0.1:5173',
    hostname: '127.0.0.1',
  }

  expect(resolveApiBase(location)).toBe('http://127.0.0.1:8000')
  expect(buildApiUrl('/api/posts', location)).toBe('http://127.0.0.1:8000/api/posts')
})

it('allows cross-origin browser requests when explicitly enabled', () => {
  vi.stubEnv('VITE_API_BASE', 'https://ai-blog-hbur.onrender.com')
  vi.stubEnv('VITE_ALLOW_CROSS_ORIGIN_API', '1')

  const location = {
    origin: 'https://www.563118077.xyz',
    hostname: 'www.563118077.xyz',
  }

  expect(resolveApiBase(location)).toBe('https://ai-blog-hbur.onrender.com')
  expect(buildApiUrl('/api/posts', location)).toBe('https://ai-blog-hbur.onrender.com/api/posts')
})
