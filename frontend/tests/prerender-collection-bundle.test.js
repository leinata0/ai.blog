/** @vitest-environment node */
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectionBootstrapBundleScript, injectCollectionBootstrapBundle } from '../scripts/collection-bootstrap-bundle.mjs'
import { main } from '../scripts/prerender-public.mjs'
import { COLLECTION_ITEM_LIMIT, COLLECTION_ROUTES, COLLECTION_SNAPSHOT_MAX_BYTES } from '../src/utils/publicCollectionSnapshot.js'

const GENERATED_AT = '2026-10-25T08:00:00.000Z'
const TEMPLATE = '<!doctype html><html><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><script type="module" src="/assets/main.js"></script></head><body><div id="root"></div><!-- TEMPLATE TAIL --></body></html>'
const daily = { slug: 'daily-actual', title: '当天真实报道', summary: '当天公开摘要', content_type: 'daily_brief' }
const weekly = { ...daily, slug: 'weekly-actual', title: '本周真实报道', content_type: 'weekly_review' }
const topic = { topic_key: 'model-release', display_title: '模型更新', post_count: 1 }
const series = { slug: 'weekly-series', title: '周报系列', post_count: 1 }
const sources = { '/daily': [daily], '/weekly': [weekly], '/topics': [topic], '/series': [series] }
const docs = []
function parse(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' })
  docs.push(dom)
  return dom.window
}

afterEach(() => {
  docs.splice(0).forEach((dom) => dom.window.close())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function build({ disabled = false } = {}) {
  vi.stubEnv('SKIP_PRERENDER', '')
  vi.stubEnv('PRERENDER_API_BASE', 'https://api.example.com')
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', disabled ? '0' : '1')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const json = (data) => ({ ok: true, status: 200, json: async () => data })
  const fetchMock = vi.fn(async (url) => {
    const path = String(url).replace('https://api.example.com', '')
    if (path.startsWith('/api/public/home-bootstrap?')) return json({ settings: {}, posts: { items: [] }, home_modules: {} })
    if (path === '/api/archive') return json([{ year: '2026', posts: [daily] }])
    if (path === '/api/topics?limit=200') return json({ items: [topic] })
    if (path === '/api/series?limit=100') return json([series])
    if (path === '/api/discover?content_type=daily_brief&limit=24') return json({ items: [daily] })
    if (path === '/api/discover?content_type=weekly_review&limit=24') return json({ items: [weekly] })
    if (path === `/api/topics/${topic.topic_key}`) return json({ ...topic, posts: [daily] })
    if (path === `/api/series/${series.slug}`) return json({ ...series, posts: [weekly] })
    if (path === `/api/posts/${daily.slug}`) return json({ ...daily, content_md: '真实公开正文' })
    throw new Error(`Unexpected build request: ${path}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const written = new Map()
  await main({ readTemplate: async () => TEMPLATE, writeRoute: async (route, html) => written.set(route, html) })
  return { written, fetchMock }
}

describe('cross-route public collection bootstrap bundle', () => {
  it('ships all four real collection snapshots in the homepage before the main module, without additional API requests', async () => {
    const { written, fetchMock } = await build()
    const home = written.get('/')
    const bundle = parse(home).__BLOG_COLLECTION_BOOTSTRAPS__
    expect(Object.keys(bundle)).toEqual(COLLECTION_ROUTES)
    expect(bundle['/daily'].items[0].slug).toBe(daily.slug)
    expect(bundle['/weekly'].items[0].slug).toBe(weekly.slug)
    expect(bundle['/topics'].items[0].topic_key).toBe(topic.topic_key)
    expect(bundle['/series'].items[0].slug).toBe(series.slug)
    expect(new Set(Object.values(bundle).map((snapshot) => snapshot.generatedAt)).size).toBe(1)
    for (const [route, snapshot] of Object.entries(bundle)) {
      expect(snapshot).toMatchObject({ schemaVersion: 1, route })
      expect(Number.isFinite(Date.parse(snapshot.generatedAt))).toBe(true)
    }
    expect(home.indexOf('window.__BLOG_COLLECTION_BOOTSTRAPS__=')).toBeLessThan(home.indexOf('<script type="module"'))
    expect(fetchMock).toHaveBeenCalledTimes(9) // Existing home + five lists + three detail requests only.
  }, 15_000)

  it('injects the same bundle on every public output including details, while keeping every private shell free of public bootstraps', async () => {
    const { written } = await build()
    const privateRoutes = new Set(['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/account', '/admin/login', '/admin/dashboard'])
    const expectedBundle = parse(written.get('/')).__BLOG_COLLECTION_BOOTSTRAPS__
    for (const [route, html] of written) {
      if (privateRoutes.has(route)) {
        expect(html).not.toContain('__BLOG_COLLECTION_BOOTSTRAP')
        continue
      }
      const window = parse(html)
      expect(window.__BLOG_COLLECTION_BOOTSTRAPS__).toEqual(expectedBundle)
      if (COLLECTION_ROUTES.includes(route)) {
        expect(window.__BLOG_COLLECTION_BOOTSTRAP__.generatedAt).toBe(expectedBundle[route].generatedAt)
        expect(window.__BLOG_COLLECTION_BOOTSTRAP__.items).toEqual(expectedBundle[route].items)
      }
    }
    for (const route of ['/archive', '/start-here', `/posts/${daily.slug}`, `/topics/${topic.topic_key}`, `/series/${series.slug}`]) expect(written.has(route)).toBe(true)
  }, 15_000)

  it('whitelists summaries, removes drafts and internal data, and keeps successful empty lists', () => {
    const script = collectionBootstrapBundleScript({
      '/daily': [
        { ...daily, content_md: 'PRIVATE_FULL_BODY', author_email: 'PRIVATE_EMAIL', internal_notes: 'PRIVATE_NOTES' },
        { ...daily, slug: 'unpublished', title: 'PRIVATE_DRAFT', is_published: false },
        { ...daily, slug: 'draft', title: 'PRIVATE_STATUS', status: 'draft' },
      ],
      '/weekly': [],
      '/topics': [{ ...topic, profile: { cover_prompt: 'PRIVATE_PROMPT', editor_notes: 'PRIVATE_EDITOR' } }],
      '/series': [{ ...series, latest_posts: [{ ...daily, content_md: 'PRIVATE_NESTED_BODY' }, { ...daily, slug: 'nested-draft', is_published: false }] }],
      '/admin': [{ title: 'PRIVATE_ADMIN' }],
    }, GENERATED_AT)
    expect(script).not.toContain('PRIVATE_')
    const bundle = parse(script).__BLOG_COLLECTION_BOOTSTRAPS__
    expect(Object.keys(bundle)).toEqual(COLLECTION_ROUTES)
    expect(bundle['/daily'].items).toHaveLength(1)
    expect(bundle['/weekly']).toMatchObject({ route: '/weekly', generatedAt: GENERATED_AT, items: [] })
    expect(bundle['/series'].items[0].latest_posts).toHaveLength(1)
    expect(bundle['/topics'].items[0]).not.toHaveProperty('profile')
  })

  it('safely parses HTML terminators, JS separators and dollar substitution sequences through literal template insertion', () => {
    const title = "价格 $&$'$`$1 </script><script>window.injected=true</script>\u2028\u2029"
    const script = collectionBootstrapBundleScript({ '/daily': [{ ...daily, title }] }, GENERATED_AT)
    const html = injectCollectionBootstrapBundle(TEMPLATE, script)
    const window = parse(html)
    expect(window.__BLOG_COLLECTION_BOOTSTRAPS__['/daily'].items[0].title).toBe(title)
    expect(window.injected).toBeUndefined()
    expect(script).not.toContain('\u2028')
    expect(script).not.toContain('\u2029')
    expect(html.match(/<!-- TEMPLATE TAIL -->/g)).toHaveLength(1)
    expect(html.match(/<div id="root"><\/div>/g)).toHaveLength(1)
  })

  it('bounds each route in UTF-8 bytes and the combined script even with maximal Unicode summaries', () => {
    const longPost = { ...daily, summary: '新'.repeat(1200), cover_image: '新'.repeat(2048), title: '新'.repeat(300), tags: Array.from({ length: 8 }, () => '新'.repeat(80)) }
    const large = Array.from({ length: 100 }, (_, index) => ({ ...longPost, slug: `large-${index}` }))
    const script = collectionBootstrapBundleScript({ ...sources, '/daily': large, '/weekly': large.map((item) => ({ ...item, content_type: 'weekly_review' })) }, GENERATED_AT)
    const bundle = parse(script).__BLOG_COLLECTION_BOOTSTRAPS__
    for (const snapshot of Object.values(bundle)) {
      expect(snapshot.items.length).toBeLessThanOrEqual(COLLECTION_ITEM_LIMIT)
      expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBeLessThanOrEqual(COLLECTION_SNAPSHOT_MAX_BYTES)
    }
    expect(bundle['/daily'].items.length).toBeGreaterThan(0)
    expect(bundle['/daily'].items[0].slug).toBe('large-0')
    expect(new TextEncoder().encode(script).byteLength).toBeLessThanOrEqual(4 * COLLECTION_SNAPSHOT_MAX_BYTES + 256)
  })

  it('omits both bundle and legacy collection scripts throughout the site when the trial is disabled', async () => {
    const { written } = await build({ disabled: true })
    for (const html of written.values()) expect(html).not.toContain('__BLOG_COLLECTION_BOOTSTRAP')
    expect(collectionBootstrapBundleScript(sources, GENERATED_AT)).toBe('')
    expect(injectCollectionBootstrapBundle(TEMPLATE, '')).toBe(TEMPLATE)
  }, 15_000)
})
