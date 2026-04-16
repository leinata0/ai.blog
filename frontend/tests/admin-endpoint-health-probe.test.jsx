import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { probeAdminEndpointHealth } from '../src/api/admin'

const REQUIRED_PATHS = [
  '/api/health',
  '/api/discover?limit=1',
  '/api/topics?limit=1',
  '/api/search?q=openai&limit=1',
  '/feed.xml',
  '/sitemap.xml',
  '/api/feeds/daily.xml',
  '/api/feeds/weekly.xml',
]

function mockSuccessResponse(path) {
  if (path === '/api/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const xml = path === '/sitemap.xml' ? '<urlset></urlset>' : '<rss version="2.0"></rss>'
  return new Response(xml, {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  })
}

function normalizePath(input) {
  const value = typeof input === 'string' ? input : input.url
  if (value.startsWith('http')) {
    const url = new URL(value)
    return `${url.pathname}${url.search}`
  }
  return value
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-16T01:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('probes all required admin health targets', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = normalizePath(input)
    return mockSuccessResponse(path)
  })

  const result = await probeAdminEndpointHealth()

  expect(result.overview.total).toBe(8)

  const calledPaths = fetchSpy.mock.calls.map(([input]) => normalizePath(input))
  REQUIRED_PATHS.forEach((path) => {
    expect(calledPaths).toContain(path)
  })
})

it('returns failure summary when a target responds with non-2xx', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = normalizePath(input)
    if (path === '/feed.xml') {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
    }
    return mockSuccessResponse(path)
  })

  const result = await probeAdminEndpointHealth()
  const feedItem = result.items.find((item) => item.path === '/feed.xml')

  expect(feedItem).toBeTruthy()
  expect(feedItem.ok).toBe(false)
  expect(feedItem.status).toBe('http_error')
  expect(feedItem.summary).toContain('HTTP 404')
  expect(result.overview.failed).toBeGreaterThanOrEqual(1)
})
