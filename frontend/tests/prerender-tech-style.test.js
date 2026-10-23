/** @vitest-environment node */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderHomePage, renderPostDetailPage, renderPrivateShell } from '../scripts/prerender-public.mjs'
import { getSurfaceForPath, getThemeColor } from '../src/utils/surface.js'

const template = (style) => `<!doctype html><html data-news-style="${style}"><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""></head><body><div id="root"></div></body></html>`
const post = { slug: 'actual-news', title: '已发布的新闻标题', summary: '来自公开接口的新闻摘要。', content_md: '## 背景\n\n报道正文摘要。', created_at: '2026-07-26T08:00:00Z' }

function styles(dom, selector) {
  return dom.window.getComputedStyle(dom.window.document.querySelector(selector))
}

describe('no-JS prerender presentation', () => {
  it('keeps the before-paint theme color aligned with runtime for public and private pages', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    for (const path of ['/', '/login', '/admin/dashboard']) {
      for (const newsStyle of ['tech', 'paper']) {
        const dom = new JSDOM(html, {
          url: `https://example.com${path}`, runScripts: 'dangerously',
          beforeParse(window) {
            window.localStorage.setItem('theme', 'dark')
            window.localStorage.setItem('news-style', newsStyle)
          },
        })
        expect(dom.window.document.documentElement.dataset.theme).toBe('dark')
        expect(dom.window.document.querySelector('meta[name="theme-color"]').content).toBe(getThemeColor(getSurfaceForPath(path), true, newsStyle))
        dom.window.close()
      }
    }
  })

  it('uses a silver reading canvas with ink headlines while preserving paper', () => {
    const tech = new JSDOM(renderPostDetailPage(template('tech'), post, 'https://example.com'))
    const paper = new JSDOM(renderPostDetailPage(template('paper'), post, 'https://example.com'))
    expect(styles(tech, '.prerender-shell').color).toBe('rgb(16, 29, 53)')
    expect(styles(tech, '.prerender-shell').backgroundColor).toBe('rgb(241, 245, 250)')
    expect(styles(tech, '.prerender-hero').backgroundColor).toBe('rgb(231, 239, 255)')
    expect(styles(tech, '.prerender-hero h1').color).toBe('rgb(16, 29, 53)')
    expect(styles(tech, '.prerender-hero h1').fontFamily).toContain('Inter')
    expect(styles(tech, '.prerender-lead').color).toBe('rgb(82, 100, 123)')
    expect(styles(tech, '.prerender-panel').backgroundColor).toBe('rgb(255, 255, 255)')
    expect(styles(tech, '.prerender-summary').color).toBe('rgb(82, 100, 123)')
    expect(styles(paper, '.prerender-shell').color).toBe('rgb(17, 24, 39)')
    expect(styles(paper, '.prerender-panel').backgroundColor).toBe('rgb(255, 255, 255)')
    expect(tech.window.document.querySelector('#root').innerHTML).toBe(paper.window.document.querySelector('#root').innerHTML)
    tech.window.close()
    paper.window.close()
  })

  it('gives no-JS news a clear sans masthead while retaining links and GET search', () => {
    const payload = { posts: { items: [{ ...post, cover_image: 'https://example.com/report.jpg' }], total: 1 }, settings: {} }
    const tech = new JSDOM(renderHomePage(template('tech'), payload, 'https://example.com'))
    const paper = new JSDOM(renderHomePage(template('paper'), payload, 'https://example.com'))
    expect(styles(tech, '.prerender-news-masthead>a').fontFamily).toContain('Inter')
    expect(styles(paper, '.prerender-news-masthead>a').fontFamily).toContain('Georgia')
    expect(styles(tech, '.prerender-news-front>article').backgroundColor).toBe('rgb(255, 255, 255)')
    expect(styles(tech, '.prerender-news-front h2').color).toBe('rgb(16, 29, 53)')
    expect(styles(tech, '.prerender-news-kicker').color).toBe('rgb(36, 84, 207)')
    expect(styles(tech, '.prerender-news-meta').color).toBe('rgb(96, 114, 138)')
    expect(styles(tech, '.prerender-news-front').gridTemplateColumns).toBe('minmax(0,1fr)')
    expect(styles(tech, '.prerender-news-front>article>a').gridColumn).toBe('2')
    expect(tech.window.document.querySelector('.prerender-news-front>article h3 a').getAttribute('href')).toBe('/posts/actual-news')
    expect(tech.window.document.querySelector('form').getAttribute('method')).toBe('get')
    expect(tech.window.document.querySelector('#root').innerHTML).toBe(paper.window.document.querySelector('#root').innerHTML)
    tech.window.close()
    paper.window.close()
  })

  it('keeps the private no-JS shell independent of the public visual style', () => {
    const props = { routePath: '/login', title: '登录', description: '登录页面' }
    const tech = new JSDOM(renderPrivateShell(template('tech'), props, 'https://example.com'))
    const paper = new JSDOM(renderPrivateShell(template('paper'), props, 'https://example.com'))
    for (const selector of ['.prerender-shell', '.prerender-hero', '.prerender-hero h1']) {
      expect(styles(tech, selector).color).toBe(styles(paper, selector).color)
      expect(styles(tech, selector).backgroundColor).toBe(styles(paper, selector).backgroundColor)
      expect(styles(tech, selector).fontFamily).toBe(styles(paper, selector).fontFamily)
    }
    tech.window.close()
    paper.window.close()
  })
})
