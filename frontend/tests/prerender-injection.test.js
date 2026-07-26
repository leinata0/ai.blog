/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SITE_SEO } from '../src/utils/contentPresentation.js'

const TEMPLATE = `<!doctype html>
<html><head>
<title>AI 资讯观察</title>
<meta name="description" content="template description">
<meta property="og:title" content="template title">
<meta property="og:description" content="template og description">
<meta property="og:url" content="https://www.563118077.xyz">
<meta property="og:image" content="">
</head><body><div id="root"></div><!-- TEMPLATE TAIL --></body></html>`

// `$&`, "$`", `$'` and `$1` are substitution patterns for String.prototype.replace when
// the replacement is a string — and escapeHtml does not escape `$`. LLM-written AI news
// hits these naturally (prices, shell snippets, regex examples).
const DOLLAR_PAYLOAD = "季度收入 $&$'$`$1 与 </script> 片段"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('injection safety', () => {
  it('keeps $-substitution patterns literal in title, description and body', async () => {
    const { renderPostDetailPage } = await import('../scripts/prerender-public.mjs')
    const html = renderPostDetailPage(TEMPLATE, {
      slug: 'dollar-post',
      title: DOLLAR_PAYLOAD,
      summary: DOLLAR_PAYLOAD,
      content_md: DOLLAR_PAYLOAD,
      created_at: '2026-07-17T00:00:00Z',
    }, 'https://www.563118077.xyz')

    // The template tail must not be spliced into the head/body by `$'`.
    expect(html).not.toContain('<title>AI 资讯观察</title>')
    expect(html.match(/<!-- TEMPLATE TAIL -->/g)).toHaveLength(1)
    expect(html.match(/<div id="root">/g)).toHaveLength(1)
    // `</script>` from the payload must stay escaped everywhere it is emitted.
    expect(html).not.toContain('</script> 片段')
    expect(html).toContain('&lt;/script&gt;')
    // The dollar sequences themselves survive verbatim (escaped only for HTML).
    expect(html).toContain("季度收入 $&amp;$&#39;$`$1")
  })

  it('does not let a $-payload break out of the inline bootstrap script', async () => {
    const { renderHomePage } = await import('../scripts/prerender-public.mjs')
    const html = renderHomePage(TEMPLATE, {
      settings: { site_name: DOLLAR_PAYLOAD },
      posts: {
        items: [{
          slug: 'dollar-post',
          title: DOLLAR_PAYLOAD,
          summary: DOLLAR_PAYLOAD,
          created_at: '2026-07-17T00:00:00Z',
        }],
      },
    }, 'https://www.563118077.xyz')

    const match = html.match(/<script>window\.__BLOG_BOOTSTRAP__=([\s\S]*?);<\/script>/)
    expect(match).toBeTruthy()
    // The serialized payload must not contain a raw `</`, which would close the element.
    expect(match[1]).not.toContain('</')
    expect(() => JSON.parse(match[1])).not.toThrow()
    expect(JSON.parse(match[1]).posts.items[0].title).toBe(DOLLAR_PAYLOAD)
    expect(html.match(/<!-- TEMPLATE TAIL -->/g)).toHaveLength(1)
  })

  it('escapes U+2028 / U+2029 in the bootstrap payload', async () => {
    const { bootstrapScript } = await import('../scripts/prerender-public.mjs')
    // JSON allows these raw inside strings, but they are LineTerminators in JS source —
    // emitted verbatim they turn the inline bootstrap script into a syntax error.
    const lineSeparator = String.fromCharCode(0x2028)
    const paragraphSeparator = String.fromCharCode(0x2029)
    const summary = `line${lineSeparator}break${paragraphSeparator}end`
    const script = bootstrapScript({ summary })

    expect(script).not.toContain(lineSeparator)
    expect(script).not.toContain(paragraphSeparator)
    expect(script).toContain('\\u2028')
    expect(script).toContain('\\u2029')

    const serialized = script.replace(/^<script>window\.__BLOG_BOOTSTRAP__=/, '').replace(/;<\/script>$/, '')
    // eslint-disable-next-line no-new-func
    expect(new Function(`return ${serialized}`)().summary).toBe(summary)
  })

  it('fails loudly when a template marker is missing instead of silently no-op injecting', async () => {
    const { renderStaticPage } = await import('../scripts/prerender-public.mjs')
    // Self-closing description tag: the old regex could not match it and the injection
    // became a silent no-op that shipped the generic template description.
    const selfClosing = TEMPLATE.replace(
      '<meta name="description" content="template description">',
      '<meta name="description" content="template description" />',
    )
    expect(() => renderStaticPage(selfClosing, {
      routePath: '/tags',
      title: '标签',
      description: '按标签浏览。',
    }, 'https://www.563118077.xyz')).not.toThrow()

    const withoutDescription = TEMPLATE.replace(/<meta name="description"[^>]*>/, '')
    expect(() => renderStaticPage(withoutDescription, {
      routePath: '/tags',
      title: '标签',
      description: '按标签浏览。',
    }, 'https://www.563118077.xyz')).toThrow(/meta\[name=description\]/)
  })

  it('drops og:image instead of emitting an empty one', async () => {
    const { renderStaticPage } = await import('../scripts/prerender-public.mjs')
    const html = renderStaticPage(TEMPLATE, {
      routePath: '/friends',
      title: '友链',
      description: '发现值得关注的站点。',
    }, 'https://www.563118077.xyz')

    expect(html).not.toContain('og:image')
  })
})

describe('canonical and SEO copy convergence', () => {
  it('reuses the shared SITE_SEO copy for the prerendered home page', async () => {
    const { renderHomePage } = await import('../scripts/prerender-public.mjs')
    const html = renderHomePage(TEMPLATE, { posts: { items: [] } }, 'https://www.563118077.xyz')

    expect(html).toContain(`<title>${SITE_SEO.homeTitle}</title>`)
    expect(html).toContain(`<meta name="description" content="${SITE_SEO.homeDescription}">`)
  })

  it('keeps index.html metadata identical to SITE_SEO', () => {
    const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

    expect(indexHtml).toContain(`<title>${SITE_SEO.homeTitle}</title>`)
    expect(indexHtml).toContain(`<meta name="description" content="${SITE_SEO.homeDescription}">`)
    expect(indexHtml).toContain(`<meta property="og:title" content="${SITE_SEO.homeTitle}">`)
    expect(indexHtml).toContain(`<meta property="og:url" content="${SITE_SEO.canonicalOrigin}">`)
  })

  it('defaults the canonical host to the shared constant', async () => {
    vi.stubEnv('PUBLIC_SITE_URL', '')
    vi.stubEnv('PRERENDER_API_BASE', 'https://api.example.com')
    const written = new Map()
    vi.stubGlobal('fetch', buildFetchStub())

    const { main } = await import('../scripts/prerender-public.mjs')
    await main({
      readTemplate: async () => TEMPLATE,
      writeRoute: async (routePath, html) => written.set(routePath, html),
    })

    expect(written.get('/')).toContain(`<link rel="canonical" href="${SITE_SEO.canonicalOrigin}">`)
    expect(written.get('/archive')).toContain(`<link rel="canonical" href="${SITE_SEO.canonicalOrigin}/archive">`)
  })
})

describe('date formatting', () => {
  it('matches src/utils/date.js and stays timezone-stable', async () => {
    const { formatDate } = await import('../scripts/prerender-public.mjs')

    // A UTC build machine and a UTC+8 visitor must not disagree by a day, and the
    // prerendered markup must not visibly change shape once the SPA hydrates.
    expect(formatDate('2026-07-17')).toBe('2026/07/17')
    expect(formatDate('2026-07-17T23:30:00Z')).toBe('2026/07/17')
    expect(formatDate('')).toBe('持续更新')
  })
})

describe('route output paths', () => {
  it('maps routes to directory index files and decodes percent-encoded segments', async () => {
    const { routeOutputPath } = await import('../scripts/prerender-public.mjs')
    const sep = /[\\/]/

    expect(routeOutputPath('/', '/dist').split(sep)).toEqual(['', 'dist', 'index.html'])
    expect(routeOutputPath('/posts/hello', '/dist').split(sep)).toEqual(['', 'dist', 'posts', 'hello', 'index.html'])
    // Vercel matches the *decoded* request path against the filesystem, so an encoded
    // directory name would silently fall through to the SPA catch-all.
    expect(routeOutputPath(`/topics/${encodeURIComponent('中文主题')}`, '/dist').split(sep))
      .toEqual(['', 'dist', 'topics', '中文主题', 'index.html'])
    expect(routeOutputPath('/topics/中文主题', '/dist')).toBe(routeOutputPath(`/topics/${encodeURIComponent('中文主题')}`, '/dist'))
  })

  it('refuses traversal segments', async () => {
    const { routeOutputPath } = await import('../scripts/prerender-public.mjs')
    expect(() => routeOutputPath('/posts/..%2F..%2Fetc', '/dist')).toThrow(/unsafe segment/)
    expect(() => routeOutputPath('/posts/../../etc', '/dist')).toThrow(/unsafe segment/)
  })
})

function buildFetchStub({ failingPostSlugs = new Set() } = {}) {
  return vi.fn(async (url) => {
    const path = String(url).replace('https://api.example.com', '')
    const json = (data) => ({ ok: true, status: 200, json: async () => data })

    if (path.startsWith('/api/public/home-bootstrap')) {
      return json({ settings: {}, home_modules: {}, posts: { items: [] } })
    }
    if (path === '/api/archive') {
      return json([{ year: '2026', posts: [{ slug: 'post-a', title: 'A' }, { slug: 'post-b', title: 'B' }] }])
    }
    if (path.startsWith('/api/topics?')) return json({ items: [] })
    if (path.startsWith('/api/series?')) return json([])
    if (path.startsWith('/api/discover')) return json({ items: [] })
    if (path.startsWith('/api/posts/')) {
      const slug = decodeURIComponent(path.replace('/api/posts/', ''))
      if (failingPostSlugs.has(slug)) return { ok: false, status: 404, json: async () => ({}) }
      return json({ slug, title: `Post ${slug}`, summary: 'summary', content_md: 'body' })
    }
    return json({})
  })
}

describe('detail prerender coverage', () => {
  it('writes an index.html for every public route and post detail', async () => {
    vi.stubEnv('PRERENDER_API_BASE', 'https://api.example.com')
    vi.stubEnv('SKIP_PRERENDER', '')
    vi.stubGlobal('fetch', buildFetchStub())
    const written = []

    const { main } = await import('../scripts/prerender-public.mjs')
    await main({
      readTemplate: async () => TEMPLATE,
      writeRoute: async (routePath) => { written.push(routePath) },
    })

    ;['/', '/archive', '/topics', '/series', '/daily', '/weekly', '/discover', '/search',
      '/following', '/start-here', '/feeds', '/tags', '/friends', '/login', '/admin/dashboard',
      '/posts/post-a', '/posts/post-b'].forEach((routePath) => {
      expect(written, `missing prerendered route ${routePath}`).toContain(routePath)
    })
  })

  it('fails the build when too many detail pages are missing', async () => {
    vi.stubEnv('PRERENDER_API_BASE', 'https://api.example.com')
    vi.stubEnv('SKIP_PRERENDER', '')
    vi.stubGlobal('fetch', buildFetchStub({ failingPostSlugs: new Set(['post-b']) }))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { main } = await import('../scripts/prerender-public.mjs')

    // 1 of 2 posts generated = 50% < the 90% floor: the missing /posts/post-b would be
    // served as the home page with a canonical pointing at the site root.
    await expect(main({
      readTemplate: async () => TEMPLATE,
      writeRoute: async () => {},
    })).rejects.toThrow(/coverage below 90%/)

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('post:post-b'))
  })
})

describe('vercel public route delivery', () => {
  it('declares an explicit rewrite for every prerendered top-level public route', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    const rewrites = config.rewrites
    const catchAllIndex = rewrites.findIndex(({ source }) => source === '/(.*)')

    ;['/archive', '/topics', '/series', '/daily', '/weekly', '/discover', '/search',
      '/start-here', '/feeds', '/following', '/tags', '/friends'].forEach((source) => {
      const index = rewrites.findIndex((rewrite) => rewrite.source === source)
      expect(index, `missing explicit rewrite for ${source}`).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(catchAllIndex)
      expect(rewrites[index].destination).toBe(`${source}/index.html`)
    })
  })
})

describe('robots.txt', () => {
  it('is served from public/ and points at the canonical sitemap', () => {
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')

    expect(robots).toContain(`Sitemap: ${SITE_SEO.canonicalOrigin}/sitemap.xml`)
    expect(robots).toContain('Disallow: /admin/')
  })
})
