/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('loadHomeBootstrap', () => {
  it('falls back to legacy public endpoints when the bootstrap endpoint is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ site_name: 'AI 资讯观察' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ slug: 'hello-world' }] }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const { loadHomeBootstrap } = await import('../scripts/prerender-public.mjs')
    const payload = await loadHomeBootstrap('https://api.example.com')

    expect(payload).toEqual({
      settings: { site_name: 'AI 资讯观察' },
      home_modules: {},
      posts: { items: [{ slug: 'hello-world' }] },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/public/home-bootstrap?page=1&page_size=10&include_modules=false',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/api/home/modules'))).toBe(false)
  })
})

describe('renderHomePage', () => {
  it('renders the hero and latest posts without topic or series sections', async () => {
    const template = `<!doctype html>
      <html><head>
        <title>Template</title>
        <meta name="description" content="">
        <meta property="og:title" content="">
        <meta property="og:description" content="">
        <meta property="og:url" content="">
      </head><body><div id="root"></div></body></html>`
    const payload = {
      settings: { hero_image: '', avatar_url: 'https://images.example.com/avatar.jpg' },
      posts: {
        items: [{
          slug: 'latest-article',
          title: '最新模型发布',
          summary: '文章摘要',
          created_at: '2026-07-17T00:00:00Z',
        }],
        total: 1,
        page: 1,
        page_size: 10,
      },
    }

    const { renderHomePage } = await import('../scripts/prerender-public.mjs')
    const html = renderHomePage(template, payload, 'https://www.example.com')

    expect(html).toContain('最新文章')
    expect(html).toContain('最新模型发布')
    expect(html).not.toContain('<h2>推荐主题</h2>')
    expect(html).not.toContain('<h2>内容系列</h2>')
    expect(html).toContain('window.__BLOG_BOOTSTRAP__=')
    expect(html).toContain('latest-article')
    expect(html).toContain('https://images.example.com/avatar.jpg')
  })
})

describe('mapWithConcurrency', () => {
  it('preserves order and never exceeds the concurrency cap', async () => {
    const { mapWithConcurrency } = await import('../scripts/prerender-public.mjs')
    let active = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6]

    const results = await mapWithConcurrency(items, 2, async (value) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 15))
      active -= 1
      return value * 10
    })

    expect(results).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('returns an empty array for empty input', async () => {
    const { mapWithConcurrency } = await import('../scripts/prerender-public.mjs')
    await expect(mapWithConcurrency([], 4, async (v) => v)).resolves.toEqual([])
  })
})
