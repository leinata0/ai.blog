/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Vercel backend routing', () => {
  it('proxies public backend resources before the SPA catch-all', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const rewrites = config.rewrites
    const catchAllIndex = rewrites.findIndex(({ source }) => source === '/(.*)')
    const feedIndex = rewrites.findIndex(({ source }) => source === '/feed.xml')
    const sitemapIndex = rewrites.findIndex(({ source }) => source === '/sitemap.xml')
    const imageProxyIndex = rewrites.findIndex(({ source }) => source === '/proxy-image')
    const uploadsIndex = rewrites.findIndex(({ source }) => source === '/uploads/(.*)')

    expect(rewrites[feedIndex]).toEqual({
      source: '/feed.xml',
      destination: 'https://ai-blog-hbur.onrender.com/feed.xml',
    })
    expect(rewrites[sitemapIndex]).toEqual({
      source: '/sitemap.xml',
      destination: 'https://ai-blog-hbur.onrender.com/sitemap.xml',
    })
    expect(rewrites[imageProxyIndex]).toEqual({
      source: '/proxy-image',
      destination: 'https://ai-blog-hbur.onrender.com/proxy-image',
    })
    expect(rewrites[uploadsIndex]).toEqual({
      source: '/uploads/(.*)',
      destination: 'https://ai-blog-hbur.onrender.com/uploads/$1',
    })
    expect(feedIndex).toBeGreaterThanOrEqual(0)
    expect(sitemapIndex).toBeGreaterThanOrEqual(0)
    expect(feedIndex).toBeLessThan(catchAllIndex)
    expect(sitemapIndex).toBeLessThan(catchAllIndex)
    expect(imageProxyIndex).toBeLessThan(catchAllIndex)
    expect(uploadsIndex).toBeLessThan(catchAllIndex)
  })
})
