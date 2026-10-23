/** @vitest-environment node */
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { main, renderHomePage } from '../scripts/prerender-public.mjs'

const TEMPLATE = '<!doctype html><html><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""></head><body><div id="root"></div></body></html>'
const SITE_URL = 'https://www.example.com'
const posts = Array.from({ length: 10 }, (_, index) => ({
  slug: `story-${index}`, title: `报道 ${index}`, summary: `第 ${index} 条报道摘要。`,
  content_type: index === 0 || index === 6 ? 'weekly_review' : 'daily_brief',
  created_at: '2026-07-25T08:00:00Z', source_count: 4, reading_time: 16,
}))
const olderWeekly = { ...posts[6], slug: 'older-weekly', title: '更早的周报', created_at: '2026-06-22T08:00:00Z' }
const topic = { topic_key: '研究 主线', display_title: '研究的实际主题', description: '原始研究与产品变化。', post_count: 5, latest_post_at: '2026-07-25T08:00:00Z' }
const series = { slug: 'daily-series', title: '日报系列', description: '围绕已发布报道继续阅读。', post_count: 124, is_featured: true, cover_image: 'https://img.example.com/series.jpg' }
const docs = []
function documentFor(payload) {
  const dom = new JSDOM(renderHomePage(TEMPLATE, payload, SITE_URL))
  docs.push(dom)
  return dom.window.document
}
function bootstrapFrom(html) {
  return JSON.parse(html.match(/<script>window\.__BLOG_BOOTSTRAP__=([\s\S]*?);<\/script>/)[1])
}

afterEach(() => {
  docs.splice(0).forEach((dom) => dom.window.close())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('shares the runtime section allocation so every homepage article appears in only one block', () => {
  const doc = documentFor({ posts: { items: [...posts, posts[4]] }, home_modules: { latest_weekly: [posts[0], posts[6], olderWeekly, olderWeekly] } })
  const slugsIn = (selector) => [...doc.querySelectorAll(`${selector} article[data-story-slug]`)].map((node) => node.dataset.storySlug)
  expect(slugsIn('#edition-focus')).toEqual(['story-0', 'story-1', 'story-2'])
  expect(slugsIn('.prerender-news-feed')).toEqual(['story-3', 'story-4', 'story-5', 'story-7', 'story-8', 'story-9'])
  expect(slugsIn('.prerender-news-deepreads')).toEqual(['story-6', 'older-weekly'])
  const allSlugs = [...doc.querySelectorAll('article[data-story-slug]')].map((node) => node.dataset.storySlug)
  expect(allSlugs).toHaveLength(11)
  expect(new Set(allSlugs).size).toBe(allSlugs.length)
  expect(doc.body.textContent).not.toContain('新闻速览')
  expect(doc.querySelector('h1').textContent).toBe('AI 新闻与观察')
})

it('keeps all four native chapter targets and real GET search and RSS links when collections are empty', () => {
  const doc = documentFor({ posts: { items: [] }, home_modules: {} })
  const chapters = ['edition-focus', 'edition-news', 'edition-topics', 'edition-reading']
  expect([...doc.querySelectorAll('[data-edition-chapter]')].map((node) => node.id)).toEqual(chapters)
  expect([...doc.querySelectorAll('[aria-label="本期阅读目录"] a')].map((link) => link.getAttribute('href'))).toEqual(chapters.map((id) => `#${id}`))
  expect(doc.querySelector('form').getAttribute('action')).toBe('/search')
  expect(doc.querySelector('form').getAttribute('method')).toBe('get')
  expect(doc.querySelector('#edition-reading a[href="/feed.xml"]').textContent).toBe('RSS 订阅')
  expect(doc.querySelector('#edition-reading a[href="/feeds"]')).not.toBeNull()
  expect(doc.querySelector('#edition-reading a[href="/daily"]')).not.toBeNull()
  expect(doc.querySelector('#edition-reading a[href="/weekly"]')).not.toBeNull()
  expect(doc.querySelector('#edition-topics').textContent).toContain('暂时没有可展示的主题与系列')
  expect(doc.querySelector('.prerender-news-topic-grid')).toBeNull()
  expect(doc.querySelector('.prerender-news-series-grid')).toBeNull()
})

it('renders available topic and single-series records without repeating their latest article titles', () => {
  const doc = documentFor({ posts: { items: [] }, home_topics: [{ ...topic, latest_post_title: '不重复呈现的文章' }], home_modules: { featured_series: [series] } })
  const topicLink = doc.querySelector('.prerender-news-topic-grid>a')
  expect(topicLink.getAttribute('href')).toBe(`/topics/${encodeURIComponent(topic.topic_key)}`)
  expect(topicLink.querySelector('h3').textContent).toBe(topic.display_title)
  expect(topicLink.textContent).toContain('5 篇文章')
  expect(topicLink.querySelector('time').getAttribute('datetime')).toBe(topic.latest_post_at)
  const seriesLink = doc.querySelector('.prerender-news-series-grid>a')
  expect(seriesLink.getAttribute('href')).toBe('/series/daily-series')
  expect(seriesLink.textContent).toContain('124 篇文章')
  expect(seriesLink.querySelector('img').getAttribute('src')).toBe(series.cover_image)
  expect(doc.querySelectorAll('.prerender-news-series-grid>a')).toHaveLength(1)
  expect(doc.querySelector('#root').textContent).not.toContain('不重复呈现的文章')
})

it('escapes dynamic story and collection values in HTML attributes, text and the injected bootstrap', () => {
  const dangerous = '引号 " </h3><script>alert(1)</script> $&'
  const payload = {
    posts: { items: [{ ...posts[0], title: dangerous, slug: 'story" onclick="bad', summary: dangerous, cover_image: 'https://img.example.com/x" onerror="bad' }] },
    home_topics: [{ ...topic, display_title: dangerous, topic_key: dangerous, description: dangerous }],
    home_modules: { featured_series: [{ ...series, title: dangerous, slug: dangerous, description: dangerous }] },
  }
  const html = renderHomePage(TEMPLATE, payload, SITE_URL)
  const dom = new JSDOM(html)
  docs.push(dom)
  const doc = dom.window.document
  expect(doc.querySelector('#root script')).toBeNull()
  expect(doc.querySelector('[onclick], [onerror]')).toBeNull()
  expect(doc.querySelector('article').dataset.storySlug).toBe(payload.posts.items[0].slug)
  expect(doc.querySelector('article h3 a').textContent).toBe(dangerous)
  expect(doc.querySelector('article h3 a').getAttribute('href')).toBe(`/posts/${encodeURIComponent(payload.posts.items[0].slug)}`)
  expect(doc.querySelector('.prerender-news-topic-grid h3').textContent).toBe(dangerous)
  expect(bootstrapFrom(html)).toEqual(payload)
})

it('enriches the homepage bootstrap from existing full-site requests before writing the home route', async () => {
  vi.stubEnv('PRERENDER_API_BASE', 'https://api.example.com')
  vi.stubEnv('PUBLIC_SITE_URL', SITE_URL)
  vi.stubEnv('SKIP_PRERENDER', '')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const topics = Array.from({ length: 5 }, (_, index) => ({ ...topic, topic_key: `topic-${index}`, profile: { notes: 'not needed in homepage bootstrap' } }))
  const seriesItems = [
    { ...series, slug: 'empty-series', post_count: 0 },
    { ...series, slug: 'not-featured', is_featured: false },
    ...Array.from({ length: 3 }, (_, index) => ({ ...series, slug: `series-${index}` })),
  ]
  const weeklyItems = [posts[0], posts[6], olderWeekly, { ...olderWeekly, slug: 'fourth-weekly' }]
  const requested = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url).replace('https://api.example.com', '')
    requested.push(path)
    const json = (data) => ({ ok: true, status: 200, json: async () => data })
    if (path.startsWith('/api/public/home-bootstrap?')) return json({ settings: { site_url: SITE_URL }, posts: { items: posts, total: 141, page: 1, page_size: 10 }, home_modules: { latest_weekly: [] } })
    if (path === '/api/archive') return json([])
    if (path === '/api/topics?limit=200') return json({ items: topics })
    if (path === '/api/series?limit=100') return json(seriesItems)
    if (path === '/api/discover?content_type=daily_brief&limit=24') return json({ items: [] })
    if (path === '/api/discover?content_type=weekly_review&limit=24') return json({ items: [...weeklyItems].reverse(), latest_weekly: weeklyItems })
    if (path.startsWith('/api/topics/')) return json(topics.find((item) => path.endsWith(item.topic_key)))
    if (path.startsWith('/api/series/')) return json(seriesItems.find((item) => path.endsWith(item.slug)))
    throw new Error(`Unexpected request: ${path}`)
  }))
  const written = new Map()
  let homeRequestSnapshot
  await main({ readTemplate: async () => TEMPLATE, writeRoute: async (routePath, html) => {
    if (routePath === '/') homeRequestSnapshot = [...requested]
    written.set(routePath, html)
  } })

  expect(homeRequestSnapshot).toHaveLength(6)
  expect(homeRequestSnapshot[0]).toBe('/api/public/home-bootstrap?page=1&page_size=10&include_modules=false')
  expect(requested.some((path) => path.startsWith('/api/home/modules'))).toBe(false)
  expect(requested.filter((path) => path.startsWith('/api/public/home-bootstrap'))).toHaveLength(1)
  const bootstrap = bootstrapFrom(written.get('/'))
  expect(bootstrap.posts.items).toEqual(posts)
  expect(bootstrap.home_topics.map((item) => item.topic_key)).toEqual(['topic-0', 'topic-1', 'topic-2', 'topic-3'])
  expect(bootstrap.home_topics[0]).not.toHaveProperty('profile')
  expect(bootstrap.home_modules.latest_weekly).toEqual(weeklyItems.slice(0, 3))
  expect(bootstrap.home_modules.featured_series.map((item) => item.slug)).toEqual(['series-0', 'series-1'])
  expect(written.has('/topics/topic-4')).toBe(true)
  expect(written.has('/series/series-2')).toBe(true)
}, 20_000)
