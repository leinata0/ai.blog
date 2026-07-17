/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Vercel public XML routing', () => {
  it('proxies feed and sitemap to Render before the SPA catch-all', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const rewrites = config.rewrites
    const catchAllIndex = rewrites.findIndex(({ source }) => source === '/(.*)')
    const feedIndex = rewrites.findIndex(({ source }) => source === '/feed.xml')
    const sitemapIndex = rewrites.findIndex(({ source }) => source === '/sitemap.xml')

    expect(rewrites[feedIndex]).toEqual({
      source: '/feed.xml',
      destination: 'https://ai-blog-hbur.onrender.com/feed.xml',
    })
    expect(rewrites[sitemapIndex]).toEqual({
      source: '/sitemap.xml',
      destination: 'https://ai-blog-hbur.onrender.com/sitemap.xml',
    })
    expect(feedIndex).toBeGreaterThanOrEqual(0)
    expect(sitemapIndex).toBeGreaterThanOrEqual(0)
    expect(feedIndex).toBeLessThan(catchAllIndex)
    expect(sitemapIndex).toBeLessThan(catchAllIndex)
  })
})
