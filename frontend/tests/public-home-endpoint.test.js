/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import collectionSnapshot, { UPSTREAM_TIMEOUT_MS, UPSTREAM_MAX_BYTES } from '../api/collection-snapshot.js'

const publicHeaders = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
const home = () => ({ settings: { author_name: 'Observer' }, posts: { items: [{ slug: 'pinned', title: 'Headline', is_pinned: true, tags: [{ name: '模型', slug: 'models' }] }], total: 141, page: 1, page_size: 10 }, home_modules: { latest_weekly: [], featured_series: [] } })
const topics = () => ({ items: [{ topic_key: 'ai', post_count: 4 }] })
const response = (payload, options = {}) => new Response(JSON.stringify(payload), { ...options, headers: { ...publicHeaders, ...options.headers } })

async function request(url = '/public-data/home.json', headers = {}) {
  const result = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value }, end(body) { this.body = body } }
  await collectionSnapshot({ method: 'GET', url, headers }, result)
  return { ...result, json: JSON.parse(result.body) }
}

function uncached(result, status = 502) {
  expect(result.statusCode).toBe(status)
  expect(result.headers['cache-control']).toBe('private, no-store')
  expect(result.headers['vercel-cdn-cache-control']).toBe('no-store')
  expect(result.headers).not.toHaveProperty('vercel-cache-tag')
  expect(result.json).not.toHaveProperty('posts')
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('public home native endpoint', () => {
  it('starts the two fixed complete sources concurrently and returns one whitelisted snapshot', async () => {
    const pendingSources = []
    const fetchMock = vi.fn((url, options) => new Promise((resolve) => pendingSources.push({ url, options, resolve })))
    vi.stubGlobal('fetch', fetchMock)
    const pending = request()
    expect(pendingSources).toHaveLength(2)
    expect(pendingSources.map(({ url }) => url)).toEqual([
      'https://ai-blog-hbur.onrender.com/api/public/home-bootstrap?page=1&page_size=10&include_modules=true',
      'https://ai-blog-hbur.onrender.com/api/topics?limit=4',
    ])
    expect(pendingSources[0].options.signal).toBe(pendingSources[1].options.signal)
    pendingSources[0].resolve(response(home()))
    pendingSources[1].resolve(response(topics()))
    const result = await pending
    expect(result.statusCode).toBe(200)
    expect(result.json).toMatchObject({ schemaVersion: 1, route: '/', posts: { total: 141, page: 1, page_size: 10 } })
    expect(result.json.posts.items[0]).toMatchObject({ is_pinned: true, tags: [{ name: '模型', slug: 'models' }] })
    expect(result.json.home_topics[0].topic_key).toBe('ai')
    expect(result.headers['vercel-cdn-cache-control']).toBe('public, max-age=60, stale-while-revalidate=120')
    expect(result.headers['cdn-cache-control']).toBe('no-store')
    for (const { options } of pendingSources) expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' } })
  })

  it('preserves truly empty successful source arrays', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(response(url.includes('home-bootstrap')
      ? { settings: {}, posts: { items: [], total: 0 }, home_modules: { latest_weekly: [], featured_series: [] } }
      : { items: [] }))))
    const result = await request('/api/collection-snapshot?route=home')
    expect(result.statusCode).toBe(200)
    expect(result.json.posts.items).toEqual([])
    expect(result.json.home_topics).toEqual([])
    expect(result.json.home_modules).toEqual({ latest_weekly: [], featured_series: [] })
  })

  it.each(['home-bootstrap', 'topics'])('does not cache when the %s source fails or is private', async (failingSource) => {
    for (const options of [{ status: 503 }, { headers: { 'Cache-Control': 'private, max-age=0' } }, { headers: { 'Set-Cookie': 'private=1' } }]) {
      const fetchMock = vi.fn((url) => Promise.resolve(response(url.includes('home-bootstrap') ? home() : topics(), url.includes(failingSource) ? options : {})))
      vi.stubGlobal('fetch', fetchMock)
      uncached(await request())
      expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    }
  })

  it.each([
    ['home-bootstrap', {}],
    ['home-bootstrap', { ...home(), settings: null }],
    ['home-bootstrap', { ...home(), home_modules: {} }],
    ['home-bootstrap', { ...home(), posts: { items: [], total: '141' } }],
    ['topics', {}], ['topics', { items: null }], ['topics', { items: [{}] }],
  ])('rejects malformed %s without manufacturing an empty section', async (source, malformed) => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(response(url.includes(source) ? malformed : url.includes('home-bootstrap') ? home() : topics()))))
    uncached(await request())
  })

  it('uses one total deadline across both upstreams including unfinished JSON bodies', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"items":[')) }, cancel })
    const fetchMock = vi.fn(async (url) => {
      if (url.includes('topics')) return new Response(stream, { headers: publicHeaders })
      await new Promise((resolve) => setTimeout(resolve, UPSTREAM_TIMEOUT_MS - 1000))
      return response(home())
    })
    vi.stubGlobal('fetch', fetchMock)
    const pending = request()
    await vi.advanceTimersByTimeAsync(UPSTREAM_TIMEOUT_MS)
    uncached(await pending, 504)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('applies the body bound to either source before caching the combined result', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve(response(url.includes('home-bootstrap') ? home() : topics(), url.includes('topics') ? { headers: { 'Content-Length': String(UPSTREAM_MAX_BYTES + 1) } } : {}))))
    uncached(await request())
  })

  it('never forwards supplied visitor headers to either fixed upstream', async () => {
    const fetchMock = vi.fn((url) => Promise.resolve(response(url.includes('home-bootstrap') ? home() : topics())))
    vi.stubGlobal('fetch', fetchMock)
    const result = await request('/public-data/home.json', { Authorization: 'Bearer visitor', Cookie: 'session=visitor', Range: 'bytes=0-20' })
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('private, no-store')
    expect(result.headers['vercel-cdn-cache-control']).toBe('no-store')
    expect(fetchMock.mock.calls.map(([, options]) => options.headers)).toEqual([{ Accept: 'application/json' }, { Accept: 'application/json' }])
  })

  it.each(['/public-data/home.json?url=https%3A%2F%2Fevil.test', '/api/collection-snapshot?route=home&include_modules=false'])('rejects extra queries instead of forwarding them: %s', async (url) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    uncached(await request(url), 400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('routes the home alias into the existing Function without additional functions', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const matched = config.rewrites.find(({ source }) => new RegExp(`^${source}$`).test('/public-data/home.json'))
    expect(matched.destination).toBe('/api/collection-snapshot?route=home')
    expect(config).not.toHaveProperty('proxy')
  })
})
