import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPublicHomeSnapshot } from '../src/utils/publicHomeSnapshot'
import { HOME_CACHE_KEY, HOME_SESSION_MAX_AGE_MS, readHomeBootstrap, saveHomeBootstrap } from '../src/utils/homeBootstrap'

const payload = (items = [{ slug: 'current', title: 'Real headline' }], generatedAt = new Date().toISOString()) => createPublicHomeSnapshot({ settings: { author_name: 'Author' }, posts: { items, total: items.length }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] }, generatedAt)
beforeEach(() => { sessionStorage.clear(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })

it('reads the home build synchronously and marks old content as a bounded preview', () => {
  const now = Date.now()
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(now - 3600000).toISOString())
  expect(readHomeBootstrap(now)).toBeNull()
  const preview = readHomeBootstrap(now, { allowPreview: true })
  expect(preview.posts.items[0].slug).toBe('current')
  expect(preview.preview).toBe(true)
  expect(preview.expiresAt).toBe(now + 8000)
  expect(preview.generatedAt).toBe(new Date(now - 3600000).toISOString())
})

it('never renews session freshness and rejects a stale response after a newer empty result', () => {
  const now = Date.now()
  saveHomeBootstrap(payload([], new Date(now).toISOString()))
  expect(saveHomeBootstrap(payload(undefined, new Date(now - 60000).toISOString())).posts.items).toEqual([])
  const raw = sessionStorage.getItem(HOME_CACHE_KEY)
  expect(readHomeBootstrap(now + 1000).expiresAt).toBe(now + HOME_SESSION_MAX_AGE_MS)
  expect(sessionStorage.getItem(HOME_CACHE_KEY)).toBe(raw)
  expect(readHomeBootstrap(now + HOME_SESSION_MAX_AGE_MS + 1, { allowPreview: true })).toBeNull()
})

it('rejects old data when a newer watermark has expired', () => {
  vi.useFakeTimers()
  const now = Date.now()
  saveHomeBootstrap(payload([], new Date(now).toISOString()))
  vi.advanceTimersByTime(HOME_SESSION_MAX_AGE_MS + 1)
  expect(saveHomeBootstrap(payload(undefined, new Date(now - 1000).toISOString()))).toBeNull()
})

it('suppresses both covered build aliases across a module reload while allowing a later build', async () => {
  const now = Date.now()
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(now + 1000).toISOString())
  window.__BLOG_BOOTSTRAP__ = payload(undefined, new Date(now + 2000).toISOString())
  saveHomeBootstrap(payload([], new Date(now).toISOString()))
  vi.resetModules()
  const reloaded = await import('../src/utils/homeBootstrap')
  expect(reloaded.readHomeBootstrap(now + 3000).posts.items).toEqual([])
  expect(reloaded.readHomeBootstrap(now + HOME_SESSION_MAX_AGE_MS + 1, { allowPreview: true })).toBeNull()
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(now + 4000).toISOString())
  expect(reloaded.readHomeBootstrap(now + 5000).posts.items[0].slug).toBe('current')
})

it('keeps the latest verified result when storage is disabled and does not restore either old build', async () => {
  vi.resetModules()
  const store = await import('../src/utils/homeBootstrap')
  const now = Date.now()
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(now + 1000).toISOString())
  window.__BLOG_BOOTSTRAP__ = payload(undefined, new Date(now + 2000).toISOString())
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled') })
  store.saveHomeBootstrap(payload([], new Date(now).toISOString()))
  expect(store.saveHomeBootstrap(payload(undefined, new Date(now - 1000).toISOString())).posts.items).toEqual([])
  expect(store.readHomeBootstrap(now + HOME_SESSION_MAX_AGE_MS + 1, { allowPreview: true })).toBeNull()
})

it('rejects future or malformed build data without treating missing sections as authoritative empty results', () => {
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(Date.now() + 120000).toISOString())
  expect(readHomeBootstrap(Date.now(), { allowPreview: true })).toBeNull()
  window.__BLOG_HOME_BOOTSTRAP__ = { ...payload(), home_topics: undefined }
  expect(readHomeBootstrap(Date.now(), { allowPreview: true })).toBeNull()
})

it('does not resurrect a same-timestamp old body after a partial empty-result storage write', async () => {
  const now = Date.now()
  saveHomeBootstrap(payload(undefined, new Date(now).toISOString()))
  window.__BLOG_HOME_BOOTSTRAP__ = payload(undefined, new Date(now + 1000).toISOString())
  const realSet = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === HOME_CACHE_KEY) throw new Error('quota')
    return realSet.call(this, key, value)
  })
  saveHomeBootstrap(payload([], new Date(now).toISOString()))
  vi.restoreAllMocks()
  vi.resetModules()
  const reloaded = await import('../src/utils/homeBootstrap')
  expect(reloaded.readHomeBootstrap(now + 2000, { allowPreview: true })).toBeNull()
  expect(reloaded.saveHomeBootstrap(payload(undefined, new Date(now).toISOString()))).toBeNull()
})
