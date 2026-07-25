/** @vitest-environment node */

import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('prerender configuration', () => {
  it('fails the build when no prerender API is configured', async () => {
    vi.stubEnv('PRERENDER_API_BASE', '')
    vi.stubEnv('VITE_API_BASE', '')
    vi.stubEnv('SKIP_PRERENDER', '')
    const { main } = await import('../scripts/prerender-public.mjs')

    await expect(main()).rejects.toThrow('PRERENDER_API_BASE or VITE_API_BASE is required')
  })

  it('only skips prerendering through the explicit opt-out', async () => {
    vi.stubEnv('PRERENDER_API_BASE', '')
    vi.stubEnv('VITE_API_BASE', '')
    vi.stubEnv('SKIP_PRERENDER', '1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { main } = await import('../scripts/prerender-public.mjs')

    await expect(main()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('explicitly skipped'))
  })
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
        status: 200,
        json: async () => ({ site_name: 'AI 资讯观察' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
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

describe('fetchWithRetry', () => {
  it('retries transient network failures and 5xx responses', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        status: 503,
        body: { cancel: vi.fn() },
      })
      .mockResolvedValueOnce({ status: 200 })
    const waitMock = vi.fn()
    const { fetchWithRetry } = await import('../scripts/prerender-public.mjs')

    await expect(fetchWithRetry('https://api.example.com/health', {}, {
      attempts: 3,
      fetchImpl: fetchMock,
      waitImpl: waitMock,
    })).resolves.toEqual({ status: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(waitMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry deterministic 4xx responses', async () => {
    const response = { status: 404 }
    const fetchMock = vi.fn().mockResolvedValue(response)
    const waitMock = vi.fn()
    const { fetchWithRetry } = await import('../scripts/prerender-public.mjs')

    await expect(fetchWithRetry('https://api.example.com/missing', {}, {
      attempts: 3,
      fetchImpl: fetchMock,
      waitImpl: waitMock,
    })).resolves.toBe(response)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(waitMock).not.toHaveBeenCalled()
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

describe('renderStaticPage', () => {
  it('renders route-specific canonical metadata and a semantic heading', async () => {
    const template = `<!doctype html><html><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""><link rel="canonical" href="https://example.com"></head><body><div id="root"></div></body></html>`
    const { renderStaticPage } = await import('../scripts/prerender-public.mjs')
    const html = renderStaticPage(template, {
      routePath: '/discover',
      title: '发现',
      description: '发现值得追踪的 AI 内容。',
    }, 'https://www.example.com')

    expect(html).toContain('<h1>发现</h1>')
    expect(html).toContain('https://www.example.com/discover')
    expect(html).toContain('发现值得追踪的 AI 内容。')
  })
})

describe('renderPrivateShell', () => {
  it('emits an inert noindex auth shell without bootstrap data', async () => {
    const template = `<!doctype html><html><head><title>Template</title><meta name="description" content=""><meta property="og:title" content=""><meta property="og:description" content=""><meta property="og:url" content=""></head><body><div id="root"></div></body></html>`
    const { renderPrivateShell } = await import('../scripts/prerender-public.mjs')
    const html = renderPrivateShell(template, {
      routePath: '/login',
      title: '登录',
      description: '登录你的阅读空间。',
      surface: 'auth',
    }, 'https://www.example.com')

    expect(html).toContain('data-prerender-private="auth"')
    expect(html).toContain('<meta name="robots" content="noindex,nofollow" data-surface-managed>')
    expect(html).toContain('https://www.example.com/login')
    expect(html).not.toContain('__BLOG_BOOTSTRAP__')
    expect(html).not.toContain('type="password"')
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
