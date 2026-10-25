import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearApiGetCache } from '../src/api/client'
import { fetchPublicCollection, prefetchPublicCollection } from '../src/api/publicCollections'
import { COLLECTION_CACHE_PREFIX, saveCollectionSnapshot } from '../src/utils/collectionBootstrap'
import { createCollectionSnapshot } from '../src/utils/publicCollectionSnapshot'

const story = { slug: 'current', title: 'Current public report', content_type: 'daily_brief', content_md: 'DO NOT SEND', internal_notes: 'PRIVATE' }
const response = (snapshot) => new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } })
beforeEach(() => {
  sessionStorage.clear(); clearApiGetCache()
  delete window.__BLOG_COLLECTION_BOOTSTRAP__; delete window.__BLOG_COLLECTION_BOOTSTRAPS__
})
afterEach(() => { clearApiGetCache(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('uses the anonymous same-origin public data path, validates the schema and preserves the source timestamp', async () => {
  const generatedAt = new Date(Date.now() - 60000).toISOString()
  const fetch = vi.fn(async () => response({ schemaVersion: 1, route: '/daily', generatedAt, items: [story] }))
  vi.stubGlobal('fetch', fetch)
  const result = await fetchPublicCollection('/daily')
  expect(fetch).toHaveBeenCalledWith('/public-data/daily.json', expect.objectContaining({ credentials: 'omit', headers: {} }))
  expect(JSON.stringify(result)).not.toMatch(/DO NOT SEND|PRIVATE/)
  expect(JSON.parse(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).generatedAt).toBe(generatedAt)
})

it('shares a navigation prefetch with the entering page instead of issuing two API requests', async () => {
  vi.stubEnv('PROD', true)
  let resolve
  vi.stubGlobal('fetch', vi.fn(() => new Promise((res) => { resolve = res })))
  const preload = prefetchPublicCollection('/daily')
  const entered = fetchPublicCollection('/daily')
  expect(fetch).toHaveBeenCalledTimes(1)
  resolve(response(createCollectionSnapshot('/daily', [story])))
  await Promise.all([preload, entered])
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('preserves the existing Vercel login only on protected deployment hosts', async () => {
  const storage = window.sessionStorage
  vi.stubGlobal('window', { location: { hostname: 'ai-blog-preview.vercel.app', origin: 'https://ai-blog-preview.vercel.app' }, sessionStorage: storage })
  vi.stubGlobal('fetch', vi.fn(async () => response(createCollectionSnapshot('/daily', []))))
  await fetchPublicCollection('/daily')
  expect(fetch).toHaveBeenCalledWith('/public-data/daily.json', expect.objectContaining({ credentials: 'same-origin', headers: {} }))
})

it('reuses fresh session data but explicit retry replaces it with an authoritative empty result', async () => {
  saveCollectionSnapshot('/daily', [story])
  vi.stubGlobal('fetch', vi.fn(async () => response(createCollectionSnapshot('/daily', []))))
  expect((await fetchPublicCollection('/daily')).items).toHaveLength(1)
  expect(fetch).not.toHaveBeenCalled()
  expect((await fetchPublicCollection('/daily', { forceRefresh: true })).items).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('returns the newer empty verification instead of displaying an older valid CDN result', async () => {
  const now = Date.now()
  saveCollectionSnapshot('/daily', [], now)
  vi.stubGlobal('fetch', vi.fn(async () => response(createCollectionSnapshot('/daily', [story], new Date(now - 60000).toISOString()))))
  const accepted = await fetchPublicCollection('/daily', { forceRefresh: true })
  expect(accepted.items).toEqual([])
  expect(accepted.generatedAt).toBe(new Date(now).toISOString())
  expect(JSON.parse(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).items).toEqual([])
})

it('does not publish a stale edge result when a newer empty response arrived while it was in flight', async () => {
  const now = Date.now()
  let resolve
  vi.stubGlobal('fetch', vi.fn(() => new Promise((done) => { resolve = done })))
  const request = fetchPublicCollection('/daily', { forceRefresh: true })
  saveCollectionSnapshot('/daily', [], now)
  resolve(response(createCollectionSnapshot('/daily', [story], new Date(now - 1000).toISOString())))
  expect((await request).items).toEqual([])
  expect(JSON.parse(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).generatedAt).toBe(new Date(now).toISOString())
})

it('rejects an old source after the empty verification expires without reviving its articles', async () => {
  vi.useFakeTimers()
  const now = Date.now()
  saveCollectionSnapshot('/daily', [], now)
  vi.advanceTimersByTime(5 * 60000 + 1)
  vi.stubGlobal('fetch', vi.fn(async () => response(createCollectionSnapshot('/daily', [story], new Date(now - 1000).toISOString()))))
  await expect(fetchPublicCollection('/daily', { forceRefresh: true })).rejects.toThrow()
  expect(JSON.parse(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).items).toEqual([])
})

it.each([
  { schemaVersion: 1, route: '/weekly', generatedAt: new Date().toISOString(), items: [story] },
  { schemaVersion: 2, route: '/daily', generatedAt: new Date().toISOString(), items: [story] },
  { schemaVersion: 1, route: '/daily', generatedAt: new Date(Date.now() - 6 * 60000).toISOString(), items: [story] },
])('rejects a mismatched or expired response without saving it', async (snapshot) => {
  vi.stubGlobal('fetch', vi.fn(async () => response(snapshot)))
  await expect(fetchPublicCollection('/daily')).rejects.toThrow()
  expect(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).toBeNull()
})

it('bounds a stalled response body to eight seconds and does not save a late body', async () => {
  vi.useFakeTimers()
  let finish
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: () => new Promise((res) => { finish = res }) })))
  const pending = fetchPublicCollection('/daily')
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(8000)
  await rejected
  finish(createCollectionSnapshot('/daily', [story]))
  await Promise.resolve()
  expect(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).toBeNull()
})

it('never fetches arbitrary routes or speculative private data', async () => {
  vi.stubEnv('PROD', true)
  vi.stubGlobal('fetch', vi.fn())
  await expect(fetchPublicCollection('/admin/dashboard')).rejects.toThrow()
  expect(prefetchPublicCollection('/account')).toBeUndefined()
  expect(fetch).not.toHaveBeenCalled()
})
