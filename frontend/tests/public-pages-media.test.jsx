import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import SeriesEditorialStack from '../src/components/SeriesEditorialStack'
import { SiteProvider } from '../src/contexts/SiteContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import HomePage from '../src/pages/HomePage'

vi.mock('../src/api/client', () => ({
  apiGet: vi.fn((path) => {
    if (path === '/api/settings') {
      return Promise.resolve({
        author_name: 'Test', bio: '', avatar_url: '', hero_image: '', github_link: '',
        announcement: '', site_url: '', friend_links: '[]',
      })
    }
    if (path === '/api/stats') return Promise.resolve({ post_count: 1, tag_count: 1, series_count: 1 })
    return Promise.resolve({})
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/posts', () => ({
  fetchPosts: vi.fn(() => Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 })),
  prefetchPostDetail: vi.fn(),
}))

vi.mock('../src/api/home', () => ({
  fetchHomeBootstrap: vi.fn(() => Promise.resolve({
    settings: {
      author_name: 'Bootstrap Test', bio: '', avatar_url: '', hero_image: '', github_link: '',
      announcement: '', site_url: 'https://www.563118077.xyz', friend_links: '[]',
    },
    posts: {
      items: [{
        title: '带封面的文章',
        slug: 'post-with-cover',
        summary: '封面来自第三方 CDN。',
        content_type: 'daily_brief',
        cover_image: 'https://third-party.example.com/cover.png',
        is_pinned: true,
        tags: [],
      }],
      total: 1,
      page: 1,
      page_size: 10,
    },
  })),
}))

const SERIES = [{
  slug: 'agents',
  title: '智能体主线',
  description: '追踪智能体的长期演进。',
  cover_image: 'https://third-party.example.com/series.png',
  post_count: 3,
}]

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  delete window.__BLOG_BOOTSTRAP__
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-ui="route-announcer-host"]').forEach((node) => node.remove())
})

describe('series cover reliability', () => {
  it('routes third-party series covers through the image proxy', () => {
    render(<MemoryRouter><SeriesEditorialStack items={SERIES} dataUi="series-stack" /></MemoryRouter>)

    const covers = screen.getAllByRole('img', { name: '智能体主线' })
    expect(covers.length).toBeGreaterThan(0)
    for (const cover of covers) {
      expect(cover.getAttribute('src')).toBe(
        `/proxy-image?url=${encodeURIComponent('https://third-party.example.com/series.png')}`,
      )
    }
  })

  it('falls back to the gradient placeholder when a series cover fails to load', async () => {
    render(<MemoryRouter><SeriesEditorialStack items={SERIES} dataUi="series-stack" /></MemoryRouter>)

    const covers = screen.getAllByRole('img', { name: '智能体主线' })
    covers.forEach((cover) => fireEvent.error(cover))

    await waitFor(() => expect(screen.queryAllByRole('img', { name: '智能体主线' })).toHaveLength(0))
    expect(screen.getAllByText('Curated Series').length).toBeGreaterThan(0)
  })
})

describe('home post cover reliability', () => {
  function renderHome() {
    return render(
      <MemoryRouter>
        <ThemeProvider>
          <SiteProvider>
            <HomePage />
          </SiteProvider>
        </ThemeProvider>
      </MemoryRouter>,
    )
  }

  it('proxies third-party post covers and drops the frame when the image 404s', async () => {
    renderHome()

    const cover = await screen.findByRole('img', { name: '带封面的文章' })
    expect(cover.getAttribute('src')).toBe(
      `/proxy-image?url=${encodeURIComponent('https://third-party.example.com/cover.png')}`,
    )

    fireEvent.error(cover)
    await waitFor(() => expect(screen.queryByRole('img', { name: '带封面的文章' })).toBeNull())
    // 卡片本身仍在，只有坏掉的封面框被移除。
    expect(screen.getAllByText('带封面的文章').length).toBeGreaterThan(0)
  })

  it('paints the pinned badge with theme tokens instead of a fixed dark amber', async () => {
    renderHome()

    const badge = await screen.findByText('推荐')
    expect(badge).toHaveStyle({ color: 'var(--text-primary)' })
    expect(badge.getAttribute('style')).toContain('var(--signal-warm-soft)')
    expect(badge.getAttribute('style')).not.toContain('#a16207')
  })
})
