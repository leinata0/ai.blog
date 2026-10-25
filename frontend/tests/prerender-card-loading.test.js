/** @vitest-environment node */
import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { renderContentTypePage, renderHomePage, renderPostDetailPage, renderSeriesListPage, renderTopicsListPage } from '../scripts/prerender-public.mjs'

const template = '<!doctype html><html><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""></head><body><div id="root"></div></body></html>'
const cover = 'https://img.example.com/original-large.png'
const story = { slug: 'own-report', title: '真实报道', summary: '公开摘要', content_type: 'daily_brief', cover_image: cover }
const variants = () => [
  [renderContentTypePage(template, '/daily', 'Daily', 'Description', [story], 'https://example.com'), '/posts/own-report'],
  [renderContentTypePage(template, '/weekly', 'Weekly', 'Description', [{ ...story, content_type: 'weekly_review' }], 'https://example.com'), '/posts/own-report'],
  [renderTopicsListPage(template, [{ topic_key: 'models', title: story.title, cover_image: cover }], 'https://example.com'), '/topics/models'],
  [renderSeriesListPage(template, [{ slug: 'collection', title: story.title, cover_image: cover }], 'https://example.com'), '/series/collection'],
]
const otherPublicCovers = () => [
  [renderHomePage(template, { posts: { items: [story] }, home_modules: { featured_series: [{ slug: 'collection', title: '内容系列', cover_image: cover, post_count: 1 }] } }, 'https://example.com'), 2],
  [renderPostDetailPage(template, { ...story, content_md: '## 正文\n\n文章正文说明。' }, 'https://example.com'), 1],
]
afterEach(() => vi.unstubAllEnvs())

it('keeps original card images out of the scripting-enabled parser while retaining SEO links and text', () => {
  for (const [html, href] of variants()) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const card = dom.window.document.querySelector('#root .prerender-card')
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('noscript').textContent).toContain(`src="${cover}"`)
    expect(card.getAttribute('href')).toBe(href)
    expect(card.querySelector('h3').textContent).toBe(story.title)
    dom.window.close()
  }
})

it('renders the same real covers when JavaScript is disabled', () => {
  for (const [html] of variants()) {
    const dom = new JSDOM(html)
    const image = dom.window.document.querySelector('#root .prerender-card img')
    expect(image.getAttribute('src')).toBe(cover)
    expect(image.closest('noscript')).not.toBeNull()
    dom.window.close()
  }
})

it('restores legacy visible card images when the performance trial is disabled', () => {
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
  for (const [html] of variants()) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const card = dom.window.document.querySelector('#root .prerender-card')
    expect(card.querySelector('noscript')).toBeNull()
    expect(card.querySelector('img').getAttribute('src')).toBe(cover)
    dom.window.close()
  }
})

it('also defers homepage headline/series and post-detail originals without losing titles and destinations', () => {
  for (const [html, count] of otherPublicCovers()) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const root = dom.window.document.querySelector('#root')
    expect(root.querySelectorAll('img')).toHaveLength(0)
    expect(root.querySelectorAll('noscript')).toHaveLength(count)
    expect(root.textContent).toContain(story.title)
    expect(root.textContent).toContain(story.summary)
    for (const noscript of root.querySelectorAll('noscript')) expect(noscript.textContent).toContain(`src="${cover}"`)
    if (root.querySelector('.prerender-news')) {
      expect(root.querySelector('article h3 a').getAttribute('href')).toBe('/posts/own-report')
      expect(root.querySelector('.prerender-news-series-grid>a').getAttribute('href')).toBe('/series/collection')
    }
    dom.window.close()
  }
})

it('keeps no-JS homepage and article covers available and restores their exact legacy image markup when disabled', () => {
  for (const [html, count] of otherPublicCovers()) {
    const dom = new JSDOM(html)
    expect(dom.window.document.querySelectorAll('#root noscript img')).toHaveLength(count)
    dom.window.close()
  }
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
  for (const [html, count] of otherPublicCovers()) {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    expect(dom.window.document.querySelectorAll('#root img')).toHaveLength(count)
    expect(dom.window.document.querySelector('#root noscript')).toBeNull()
    dom.window.close()
  }
})
