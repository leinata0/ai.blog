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
