import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import template from '../index.html?raw'
import { COLLECTION_BUILD_MAX_AGE_MS, COLLECTION_CACHE_PREFIX, COLLECTION_SESSION_MAX_AGE_MS, readCollectionBootstrap, saveCollectionSnapshot } from '../src/utils/collectionBootstrap'
import { createCollectionSnapshot } from '../src/utils/publicCollectionSnapshot'
import { collectionBootstrapScript, renderContentTypePage, renderTopicsListPage, renderSeriesListPage } from '../scripts/prerender-public.mjs'

const post = { slug: 'real-story', title: 'Own title', content_type: 'daily_brief', cover_image: 'https://img.example/real.jpg', summary: 'Public summary', content_md: 'PRIVATE FULL BODY', internal_notes: 'DO NOT SHIP', status: 'published' }
const parseScript = (script) => JSON.parse(script.match(/__BLOG_COLLECTION_BOOTSTRAP__=(.*);<\/script>/s)[1])

beforeEach(() => { sessionStorage.clear(); delete window.__BLOG_COLLECTION_BOOTSTRAP__; delete window.__BLOG_COLLECTION_BOOTSTRAPS__ })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); delete window.__BLOG_COLLECTION_BOOTSTRAP__; delete window.__BLOG_COLLECTION_BOOTSTRAPS__ })

it('embeds bounded public summaries, rejects explicit drafts and escapes inline script termination', () => {
  const script = collectionBootstrapScript('/daily', [{ ...post, title: '</script><script>alert(1)</script>\u2028\u2029' }, { ...post, slug: 'draft', status: 'draft' }, ...Array.from({ length: 50 }, (_, index) => ({ ...post, slug: `post-${index}` }))])
  expect(script.match(/<\/script>/g)).toHaveLength(1)
  expect(script).not.toContain('\u2028')
  expect(script).not.toContain('PRIVATE FULL BODY')
  expect(script).not.toContain('DO NOT SHIP')
  const snapshot = parseScript(script)
  expect(snapshot.items).toHaveLength(24)
  expect(snapshot.items[0].title).toBe('</script><script>alert(1)</script>\u2028\u2029')
  expect(snapshot.items.some((item) => item.slug === 'draft')).toBe(false)
  expect(snapshot.schemaVersion).toBe(1)
  expect(Date.parse(snapshot.generatedAt)).toBeGreaterThan(0)
})

it('whitelists nested series summaries and topic profile fields', () => {
  const topic = parseScript(collectionBootstrapScript('/topics', [{ topic_key: 'models', profile: { display_title: 'Models', cover_image: 'https://img.example/topic.jpg', editor_note: 'SECRET PROFILE' }, posts: [post] }]))
  expect(topic.items[0].display_title).toBe('Models')
  expect(topic.items[0]).not.toHaveProperty('profile')
  expect(topic.items[0]).not.toHaveProperty('posts')
  const series = parseScript(collectionBootstrapScript('/series', [{ slug: 'collection', title: 'Collection', latest_posts: Array.from({ length: 10 }, (_, i) => ({ ...post, slug: `nested-${i}` })), posts: [post], admin_notes: 'SECRET SERIES' }]))
  expect(series.items[0].latest_posts).toHaveLength(3)
  expect(JSON.stringify(series)).not.toMatch(/content_md|admin_notes|PRIVATE|SECRET/)
})

it('injects snapshots only into the four corresponding public list HTML pages', () => {
  const cases = [
    ['/daily', renderContentTypePage(template, '/daily', 'Daily', 'Description', [post], 'https://example.com')],
    ['/weekly', renderContentTypePage(template, '/weekly', 'Weekly', 'Description', [{ ...post, content_type: 'weekly_review' }], 'https://example.com')],
    ['/topics', renderTopicsListPage(template, [{ topic_key: 'models' }], 'https://example.com')],
    ['/series', renderSeriesListPage(template, [{ slug: 'collection' }], 'https://example.com')],
  ]
  for (const [route, html] of cases) expect(parseScript(html).route).toBe(route)
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
  expect(collectionBootstrapScript('/daily', [post])).toBe('')
})

it('rejects wrong routes, schema versions, future dates and expired snapshots', () => {
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now).toISOString())
  expect(readCollectionBootstrap('/daily', now)?.items[0].slug).toBe(post.slug)
  expect(readCollectionBootstrap('/weekly', now)).toBeNull()
  expect(readCollectionBootstrap('/daily', now + COLLECTION_BUILD_MAX_AGE_MS)).toBeNull()
  window.__BLOG_COLLECTION_BOOTSTRAP__.schemaVersion = 2
  expect(readCollectionBootstrap('/daily', now)).toBeNull()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now + 120000).toISOString())
  expect(readCollectionBootstrap('/daily', now)).toBeNull()
})

it('never renews a snapshot timestamp on reads and prefers newer runtime data', () => {
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now - 60000).toISOString())
  saveCollectionSnapshot('/daily', [{ ...post, slug: 'fresh-story' }], now)
  const raw = sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)
  expect(readCollectionBootstrap('/daily', now + 1000).items[0].slug).toBe('fresh-story')
  expect(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).toBe(raw)
  expect(readCollectionBootstrap('/daily', now + COLLECTION_SESSION_MAX_AGE_MS)).toBeNull()
})

it('does not resurrect an older build snapshot after a successful empty refresh', () => {
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now - 60000).toISOString())
  saveCollectionSnapshot('/daily', [], now)
  expect(readCollectionBootstrap('/daily', now).items).toEqual([])
  expect(readCollectionBootstrap('/daily', now + COLLECTION_SESSION_MAX_AGE_MS + 1)).toBeNull()
  sessionStorage.clear()
  expect(readCollectionBootstrap('/daily', now + 1000)).toBeNull()
})

it('keeps a newer empty verification when an older or equal nonempty source arrives', () => {
  const now = Date.now()
  saveCollectionSnapshot('/daily', [], now)
  const accepted = saveCollectionSnapshot('/daily', [post], now - 60000)
  expect(accepted.items).toEqual([])
  expect(accepted.generatedAt).toBe(new Date(now).toISOString())
  expect(accepted.expiresAt).toBe(now + COLLECTION_SESSION_MAX_AGE_MS)
  expect(saveCollectionSnapshot('/daily', [post], now).items).toEqual([])
  expect(readCollectionBootstrap('/daily', now).items).toEqual([])
})

it('rejects an older source after its newer empty verification has expired', () => {
  vi.useFakeTimers()
  const now = Date.now()
  saveCollectionSnapshot('/daily', [], now)
  vi.advanceTimersByTime(COLLECTION_SESSION_MAX_AGE_MS + 1)
  expect(saveCollectionSnapshot('/daily', [post], now - 1000)).toBeNull()
  expect(readCollectionBootstrap('/daily', Date.now(), { allowPreview: true })).toBeNull()
})

it('persists verification of both current build objects across reload without renewing source freshness', async () => {
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now + 1000).toISOString())
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [post], new Date(now + 2000).toISOString()) }
  saveCollectionSnapshot('/daily', [], now)
  const beforeReload = sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)
  vi.resetModules()
  const reloaded = await import('../src/utils/collectionBootstrap')
  expect(reloaded.readCollectionBootstrap('/daily', now + 3000).items).toEqual([])
  expect(reloaded.readCollectionBootstrap('/daily', now + COLLECTION_SESSION_MAX_AGE_MS + 1, { allowPreview: true })).toBeNull()
  expect(sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}/daily`)).toBe(beforeReload)
  expect(JSON.parse(beforeReload).generatedAt).toBe(new Date(now).toISOString())
})

it('permits a genuinely later build as a dated preview after reload', async () => {
  vi.useFakeTimers()
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [post], new Date(now - 60000).toISOString()) }
  saveCollectionSnapshot('/daily', [], now)
  vi.advanceTimersByTime(2 * 60 * 60 * 1000)
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [{ ...post, slug: 'new-build' }], new Date(now + 60 * 60 * 1000).toISOString()) }
  vi.resetModules()
  const reloaded = await import('../src/utils/collectionBootstrap')
  const preview = reloaded.readCollectionBootstrap('/daily', Date.now(), { allowPreview: true })
  expect(preview.items[0].slug).toBe('new-build')
  expect(preview.preview).toBe(true)
  expect(preview.generatedAt).toBe(new Date(now + 60 * 60 * 1000).toISOString())
})

it('protects the current document with bounded memory when session storage is unavailable', async () => {
  vi.resetModules()
  const unavailable = await import('../src/utils/collectionBootstrap')
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled') })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
  const now = Date.now()
  window.__BLOG_COLLECTION_BOOTSTRAP__ = createCollectionSnapshot('/daily', [post], new Date(now + 1000).toISOString())
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [post], new Date(now + 2000).toISOString()) }
  unavailable.saveCollectionSnapshot('/daily', [], now)
  expect(unavailable.saveCollectionSnapshot('/daily', [post], now - 60000).items).toEqual([])
  expect(unavailable.readCollectionBootstrap('/daily', now).items).toEqual([])
  expect(unavailable.readCollectionBootstrap('/daily', now + COLLECTION_SESSION_MAX_AGE_MS + 1, { allowPreview: true })).toBeNull()
  expect(unavailable.saveCollectionSnapshot('/not-allowlisted', [post], now)).toBeNull()
})

it('does not revive a same-timestamp nonempty body if only the empty watermark write succeeded', async () => {
  const now = Date.now()
  saveCollectionSnapshot('/daily', [post], now)
  window.__BLOG_COLLECTION_BOOTSTRAPS__ = { '/daily': createCollectionSnapshot('/daily', [post], new Date(now + 1000).toISOString()) }
  const realSetItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === `${COLLECTION_CACHE_PREFIX}/daily`) throw new Error('quota')
    return realSetItem.call(this, key, value)
  })
  saveCollectionSnapshot('/daily', [], now)
  vi.restoreAllMocks()
  vi.resetModules()
  const reloaded = await import('../src/utils/collectionBootstrap')
  expect(reloaded.readCollectionBootstrap('/daily', now + 1001, { allowPreview: true })).toBeNull()
  expect(reloaded.saveCollectionSnapshot('/daily', [post], now - 1)).toBeNull()
})
