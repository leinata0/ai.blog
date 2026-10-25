import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearApiGetCache } from '../src/api/client'
import { fetchPublicHome, prefetchPublicHome } from '../src/api/publicHome'
import { createPublicHomeSnapshot } from '../src/utils/publicHomeSnapshot'
import { HOME_CACHE_KEY, saveHomeBootstrap } from '../src/utils/homeBootstrap'

const snapshot = (items = [{ slug: 'news', title: 'Current news' }], generatedAt = new Date().toISOString()) => createPublicHomeSnapshot({ settings: {}, posts: { items, total: items.length }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] }, generatedAt)
const response = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => { vi.stubEnv('PROD', true); sessionStorage.clear(); clearApiGetCache(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearApiGetCache() })

it('uses the public anonymous endpoint and preserves the CDN source timestamp', async () => {
  const time = new Date(Date.now() - 60000).toISOString()
  vi.stubGlobal('fetch', vi.fn(async () => response(snapshot(undefined, time))))
  const home = await fetchPublicHome()
  expect(fetch).toHaveBeenCalledWith('/public-data/home.json', expect.objectContaining({ credentials: 'omit', headers: {} }))
  expect(home.generatedAt).toBe(time)
  expect(JSON.parse(sessionStorage.getItem(HOME_CACHE_KEY)).generatedAt).toBe(time)
})

it('shares an intent prefetch with a page without letting one cancelled consumer cancel it', async () => {
  let finish
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve })))
  const controller = new AbortController()
  const first = prefetchPublicHome()
  const entered = fetchPublicHome({ signal: controller.signal })
  controller.abort()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(false)
  finish(response(snapshot()))
  expect((await entered).posts.items).toHaveLength(1)
  await first
})

it('preserves login on protected Vercel previews without changing the public production policy', async () => {
  const storage = sessionStorage
  vi.stubGlobal('window', { sessionStorage: storage, location: { hostname: 'preview.vercel.app', origin: 'https://preview.vercel.app' } })
  vi.stubGlobal('fetch', vi.fn(async () => response(snapshot([]))))
  await fetchPublicHome()
  expect(fetch.mock.calls[0][1].credentials).toBe('same-origin')
})

it('reuses fresh session data while forced refresh accepts authoritative empty content', async () => {
  saveHomeBootstrap(snapshot())
  vi.stubGlobal('fetch', vi.fn(async () => response(snapshot([]))))
  expect((await fetchPublicHome()).posts.items).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  expect((await fetchPublicHome({ forceRefresh: true })).posts.items).toEqual([])
})

it('does not display an old CDN nonempty response after a newer empty verification', async () => {
  const now = Date.now()
  saveHomeBootstrap(snapshot([], new Date(now).toISOString()))
  vi.stubGlobal('fetch', vi.fn(async () => response(snapshot(undefined, new Date(now - 1000).toISOString()))))
  expect((await fetchPublicHome({ forceRefresh: true })).posts.items).toEqual([])
})

it('rejects expired or incomplete data instead of saving fake empty content', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(snapshot(undefined, new Date(Date.now() - 360000).toISOString()))).mockResolvedValueOnce(response({ schemaVersion: 1, route: '/', generatedAt: new Date().toISOString() })))
  await expect(fetchPublicHome()).rejects.toThrow()
  await expect(fetchPublicHome()).rejects.toThrow()
  expect(sessionStorage.getItem(HOME_CACHE_KEY)).toBeNull()
})

it('bounds a stalled body to eight seconds and never persists a late body', async () => {
  vi.useFakeTimers()
  let finish
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: () => new Promise((resolve) => { finish = resolve }) })))
  const pending = fetchPublicHome()
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(8000)
  await rejected
  finish(snapshot())
  await Promise.resolve()
  expect(sessionStorage.getItem(HOME_CACHE_KEY)).toBeNull()
})

it('loads the full development bootstrap and topics in parallel without a settings/posts waterfall', async () => {
  vi.stubEnv('PROD', false)
  const requests = []
  vi.stubGlobal('fetch', vi.fn((url) => new Promise((resolve) => { requests.push({ url, resolve }) })))
  const pending = fetchPublicHome()
  expect(requests).toHaveLength(2)
  expect(requests.map((request) => request.url)).toEqual([
    '/api/public/home-bootstrap?page=1&page_size=10&include_modules=true', '/api/topics?limit=4',
  ])
  requests[0].resolve(response(snapshot()))
  requests[1].resolve(response({ items: [{ topic_key: 'models', display_title: 'Models' }] }))
  const home = await pending
  expect(home.posts.items[0].slug).toBe('news')
  expect(home.home_topics[0].topic_key).toBe('models')
  expect(fetch).toHaveBeenCalledTimes(2)
})
