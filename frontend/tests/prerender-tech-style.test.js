/** @vitest-environment node */
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { renderHomePage, renderPostDetailPage } from '../scripts/prerender-public.mjs'

const template = (style) => `<!doctype html><html data-news-style="${style}"><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""></head><body><div id="root"></div></body></html>`
const post = { slug: 'actual-news', title: '已发布的新闻标题', summary: '来自公开接口的新闻摘要。', content_md: '## 背景\n\n报道正文摘要。', created_at: '2026-07-26T08:00:00Z' }

function styles(dom, selector) {
  return dom.window.getComputedStyle(dom.window.document.querySelector(selector))
}

describe('no-JS prerender presentation', () => {
  it('uses readable dark public surfaces for tech and leaves paper styling unchanged', () => {
    const tech = new JSDOM(renderPostDetailPage(template('tech'), post, 'https://example.com'))
    const paper = new JSDOM(renderPostDetailPage(template('paper'), post, 'https://example.com'))
    expect(styles(tech, '.prerender-shell').color).toBe('rgb(238, 244, 255)')
    expect(styles(tech, '.prerender-panel').backgroundColor).toBe('rgb(16, 23, 35)')
    expect(styles(tech, '.prerender-summary').color).toBe('rgb(166, 183, 203)')
    expect(styles(paper, '.prerender-shell').color).toBe('rgb(17, 24, 39)')
    expect(styles(paper, '.prerender-panel').backgroundColor).toBe('rgb(255, 255, 255)')
    expect(tech.window.document.querySelector('#root').innerHTML).toBe(paper.window.document.querySelector('#root').innerHTML)
    tech.window.close()
    paper.window.close()
  })

  it('gives the no-JS news masthead a sans face and keeps the real links and GET search', () => {
    const payload = { posts: { items: [post], total: 1 }, settings: {} }
    const tech = new JSDOM(renderHomePage(template('tech'), payload, 'https://example.com'))
    const paper = new JSDOM(renderHomePage(template('paper'), payload, 'https://example.com'))
    expect(styles(tech, '.prerender-news-masthead>a').fontFamily).toContain('Inter')
    expect(styles(paper, '.prerender-news-masthead>a').fontFamily).toContain('Georgia')
    expect(styles(tech, '.prerender-news-kicker').color).toBe('rgb(109, 227, 255)')
    expect(styles(tech, '.prerender-news-meta').color).toBe('rgb(156, 174, 197)')
    expect(tech.window.document.querySelector('.prerender-news-front h2 a').getAttribute('href')).toBe('/posts/actual-news')
    expect(tech.window.document.querySelector('form').getAttribute('method')).toBe('get')
    expect(tech.window.document.querySelector('#root').innerHTML).toBe(paper.window.document.querySelector('#root').innerHTML)
    tech.window.close()
    paper.window.close()
  })
})
