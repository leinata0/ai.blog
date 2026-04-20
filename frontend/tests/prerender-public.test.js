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
        json: async () => ({ topic_pulse: { items: [{ topic_key: 'openai' }] } }),
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
      home_modules: { topic_pulse: { items: [{ topic_key: 'openai' }] } },
      posts: { items: [{ slug: 'hello-world' }] },
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/api/public/home-bootstrap?page=1&page_size=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
