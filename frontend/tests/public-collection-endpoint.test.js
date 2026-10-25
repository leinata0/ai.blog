/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import collectionSnapshot, { UPSTREAM_MAX_BYTES, UPSTREAM_TIMEOUT_MS } from '../api/collection-snapshot.js'

const publicHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=0, must-revalidate' }
const post = (overrides = {}) => ({ slug: 'public-post', title: 'Published news', content_type: 'daily_brief', ...overrides })
const upstream = (payload = { items: [post()] }, options = {}) => new Response(JSON.stringify(payload), {
  ...options, headers: { ...publicHeaders, ...options.headers },
})

async function request({ url = '/api/collection-snapshot?route=daily', method = 'GET', headers = {}, query } = {}) {
  const response = {
    statusCode: 0, headers: {}, body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    end(body) { this.body = body },
  }
  await collectionSnapshot({ method, url, headers, query }, response)
  return { ...response, json: JSON.parse(response.body) }
}

function expectUncached(response, status) {
  expect(response.statusCode).toBe(status)
  expect(response.headers['cache-control']).toBe('private, no-store')
  expect(response.headers['cdn-cache-control']).toBe('no-store')
  expect(response.headers['vercel-cdn-cache-control']).toBe('no-store')
  expect(response.headers).not.toHaveProperty('vercel-cache-tag')
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('public collection function boundary', () => {
  it.each([
    ['daily', '/api/discover', 'daily_brief'],
    ['weekly', '/api/discover', 'weekly_review'],
    ['topics', '/api/topics', null],
    ['series', '/api/series', null],
  ])('fetches only the fixed %s collection with limit 24', async (route, pathname, contentType) => {
    const payload = route === 'topics' ? [{ topic_key: 'ai', display_title: 'AI' }]
      : route === 'series' ? [{ slug: 'series', title: 'Series' }]
        : { items: [post({ content_type: contentType })] }
    const fetchMock = vi.fn().mockResolvedValue(upstream(payload))
    vi.stubGlobal('fetch', fetchMock)
    const result = await request({ url: `/api/collection-snapshot?route=${route}` })
    expect(result.statusCode).toBe(200)
    expect(result.json).toMatchObject({ schemaVersion: 1, route: `/${route}` })
    expect(Date.parse(result.json.generatedAt)).not.toBeNaN()
    expect(result.json.items).toHaveLength(1)
    const [url, options] = fetchMock.mock.calls[0]
    const resolved = new URL(url)
    expect(resolved.origin).toBe('https://ai-blog-hbur.onrender.com')
    expect(resolved.pathname).toBe(pathname)
    expect(resolved.searchParams.get('limit')).toBe('24')
    if (contentType) {
      expect(resolved.searchParams.get('content_type')).toBe(contentType)
      expect(resolved.searchParams.get('sections')).toBe('items,total')
    }
    expect(options).toMatchObject({ method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error' })
    expect(result.headers['vercel-cdn-cache-control']).toBe('public, max-age=60, stale-while-revalidate=120')
    expect(result.headers['cdn-cache-control']).toBe('no-store')
  })

  it('accepts Vercel-injected query parameters and the original public alias URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream()))
    const result = await request({ url: '/public-data/daily.json', query: { route: 'daily' } })
    expect(result.statusCode).toBe(200)
    expect(result.json.route).toBe('/daily')
  })

  it.each([
    '/api/collection-snapshot',
    '/api/collection-snapshot?route=private',
    '/api/collection-snapshot?route=__proto__',
    '/api/collection-snapshot?route=https%3A%2F%2Fevil.test',
    '/api/collection-snapshot?route=daily&url=https%3A%2F%2Fevil.test',
    '/api/collection-snapshot?route=daily&limit=200',
    '/api/collection-snapshot?route=daily&route=weekly',
    '/public-data/daily.json?route=weekly',
  ])('rejects an unknown route, duplicate or unapproved query: %s', async (url) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expectUncached(await request({ url }), 400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{ route: ['daily', 'weekly'] }, { route: 'daily', token: 'secret' }, { route: 'weekly' }])('validates injected parameters without trusting their shape', async (query) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expectUncached(await request({ query }), 400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['POST', 'HEAD', 'OPTIONS'])('does not cache or fetch %s requests', async (method) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await request({ method })
    expectUncached(result, 405)
    expect(result.headers.allow).toBe('GET')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([{ Authorization: 'Bearer private' }, { Cookie: 'session=private' }, { Range: 'bytes=0-100' }, { cookie: '' }])('never forwards client credentials or caches a credential/range request', async (headers) => {
    const fetchMock = vi.fn().mockResolvedValue(upstream())
    vi.stubGlobal('fetch', fetchMock)
    const result = await request({ headers })
    expectUncached(result, 200)
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' })
    expect(result.json.items).toHaveLength(1)
  })

  it('keeps a successful empty collection authoritative and cacheable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream({ items: [] })))
    const result = await request()
    expect(result.statusCode).toBe(200)
    expect(result.json.items).toEqual([])
    expect(result.headers['vercel-cdn-cache-control']).toContain('max-age=60')
  })

  it('uses the shared public field whitelist, excludes unpublished rows and caps summaries', async () => {
    const payload = { items: [post({ status: 'draft' }), post({ slug: 'hidden', is_published: false }), ...Array.from({ length: 30 }, (_, index) => post({
      slug: `public-${index}`, content: 'private full text', author_email: 'private@example.test', private_profile: 'secret',
      title: 'a'.repeat(400), summary: 'b'.repeat(2000),
    }))] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream(payload)))
    const result = await request()
    expect(result.statusCode).toBe(200)
    expect(result.json.items).toHaveLength(24)
    expect(result.json.items[0]).toMatchObject({ slug: 'public-0', title: 'a'.repeat(300), summary: 'b'.repeat(1200) })
    expect(result.body).not.toMatch(/private full text|private@example|private_profile|hidden/)
  })

  it.each([
    { status: 500 },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
    { headers: { 'Cache-Control': 'public, no-store' } },
    { headers: { 'Cache-Control': 'public, no-cache' } },
    { headers: { 'Cache-Control': '' } },
    { headers: { 'Set-Cookie': 'session=private' } },
    { headers: { 'Content-Type': 'text/html' } },
  ])('rejects unsafe or unsuccessful upstream responses %j', async (options) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream(undefined, options)))
    const result = await request()
    expectUncached(result, 502)
    expect(result.json).not.toHaveProperty('items')
  })

  it.each([{}, { items: null }, { items: {} }])('does not turn malformed collections into cacheable empty results', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream(payload)))
    expectUncached(await request(), 502)
  })

  it('does not cache invalid JSON or network failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{invalid', { headers: publicHeaders }))
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
    vi.stubGlobal('fetch', fetchMock)
    expectUncached(await request(), 502)
    expectUncached(await request(), 502)
  })

  it('bounds headers and complete-body reading by the same deadline and aborts stalled fetches', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const pending = request()
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS)
    expectUncached(await pending, 504)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(UPSTREAM_TIMEOUT_MS).toBeLessThanOrEqual(6000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out and cancels an unfinished body after headers have already arrived', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"items":[')) }, cancel })
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { headers: publicHeaders }))
    vi.stubGlobal('fetch', fetchMock)
    const pending = request()
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS)
    expectUncached(await pending, 504)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  })

  it('counts body download time toward the total deadline', async () => {
    vi.useFakeTimers()
    let bodyController
    const stream = new ReadableStream({ start(controller) { bodyController = controller } })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, UPSTREAM_TIMEOUT_MS - 1000))
      return new Response(stream, { headers: publicHeaders })
    }))
    const pending = request()
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS - 1000)
    bodyController.enqueue(new TextEncoder().encode('{"items":['))
    await vi.advanceTimersByTimeAsync(1000)
    expectUncached(await pending, 504)
  })

  it('bounds streamed body size even without a Content-Length', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(UPSTREAM_MAX_BYTES + 1)) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { headers: publicHeaders })))
    expectUncached(await request(), 502)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects a declared oversized body before consuming it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream(undefined, { headers: { 'Content-Length': String(UPSTREAM_MAX_BYTES + 1) } })))
    expectUncached(await request(), 502)
  })
})

describe('public collection function deployment routing', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const matches = (rule, path) => new RegExp(`^${rule.source}$`).test(path)

  it.each(['daily', 'weekly', 'topics', 'series'])('routes the public %s alias to the internal function before the SPA', (route) => {
    const rule = config.rewrites.find((entry) => matches(entry, `/public-data/${route}.json`))
    expect(rule.destination).toBe(`/api/collection-snapshot?route=${route}`)
  })

  it('does not swallow the function path in either the Render rewrite or SPA fallback', () => {
    expect(config.rewrites.filter((rule) => matches(rule, '/api/collection-snapshot'))).toEqual([])
    const backend = config.rewrites.find((rule) => rule.destination.startsWith('https://ai-blog-hbur.onrender.com/api/'))
    for (const path of ['/api/discover', '/api/topics', '/api/series', '/api/posts/x', '/api/admin/posts', '/api/collection-snapshot/extra']) {
      expect(matches(backend, path)).toBe(true)
    }
    const fallback = config.rewrites.find((rule) => rule.destination === '/index.html')
    expect(matches(fallback, '/other-client-page')).toBe(true)
    expect(matches(fallback, '/api/collection-snapshot/extra')).toBe(true)
  })
})
