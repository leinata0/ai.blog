/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const policyKey = 'x-vercel-enable-rewrite-caching'

// These rules use literal paths and `(.*)` only. Evaluate their path + missing
// conditions together so a broadened pattern or a lost auth guard fails the
// negative request cases, rather than merely asserting a JSON snapshot.
function rewriteCachePolicy(path, requestHeaders = {}) {
  const url = new URL(path, 'https://example.test')
  const headers = new Headers(requestHeaders)
  let policy
  for (const rule of config.headers) {
    if (!new RegExp(`^${rule.source}$`).test(url.pathname)) continue
    const missing = (rule.missing || []).every(({ type, key }) => {
      expect(type).toBe('header')
      return !headers.has(key)
    })
    if (!missing) continue
    for (const header of rule.headers) {
      if (header.key.toLowerCase() === policyKey) policy = header.value
    }
  }
  return policy
}

describe('public collection rewrite cache boundary', () => {
  it.each([
    '/api/discover?content_type=daily_brief&sections=items,total',
    '/api/discover?content_type=weekly_review&sections=items,total',
    '/api/topics?limit=24',
    '/api/series?featured=true',
  ])('opts in anonymous collection request %s without rewriting query keys', (url) => {
    expect(rewriteCachePolicy(url)).toBe('1')
    const apiRewrite = config.rewrites.find(({ source }) => source === '/api/(.*)')
    expect(apiRewrite.destination).toBe('https://ai-blog-hbur.onrender.com/api/$1')
    expect(apiRewrite).not.toHaveProperty('has')
  })

  it.each(['/api/discover', '/api/topics', '/api/series'])('bypasses credentials for %s', (path) => {
    expect(rewriteCachePolicy(path, { Authorization: 'Bearer secret' })).toBe('0')
    expect(rewriteCachePolicy(path, { Cookie: 'session=private' })).toBe('0')
    expect(rewriteCachePolicy(path, { Authorization: '', Cookie: '' })).toBe('0')
  })

  it.each([
    '/api/topics/private-key', '/api/topics/', '/api/topics-extra',
    '/api/series/secret', '/api/series/', '/api/discover/preview',
    '/api/admin/posts', '/api/users/me', '/api/subscriptions',
    '/api/posts/draft', '/api/search?q=private', '/api/health',
  ])('does not enable unrelated or detail rewrite %s', (path) => {
    expect(rewriteCachePolicy(path)).toBe('0')
  })

  it('never forces a cacheable TTL over origin response safety decisions', () => {
    for (const rule of config.headers.filter(({ source }) => source.startsWith('/api/'))) {
      expect(rule.headers.every(({ key }) => key.toLowerCase() === policyKey)).toBe(true)
    }
    expect(config.headers.filter(({ headers }) => headers.some(({ key, value }) => key === policyKey && value === '1')))
      .toHaveLength(3)
  })
})
