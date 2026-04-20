import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { SiteProvider, useSite } from '../src/contexts/SiteContext'
import { fetchHomeBootstrap } from '../src/api/home'
import { apiGet } from '../src/api/client'

vi.mock('../src/api/client', () => ({
  apiGet: vi.fn((path) => {
    if (path === '/api/stats') {
      return Promise.resolve({ post_count: 4, tag_count: 3, series_count: 2 })
    }
    if (path === '/api/settings') {
      return Promise.resolve({
        author_name: 'Fallback Author',
        bio: '',
        avatar_url: '',
        hero_image: '',
        github_link: '',
        announcement: '',
        site_url: 'https://563118077.xyz',
        friend_links: '[]',
      })
    }
    return Promise.resolve({})
  }),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/home', async () => {
  const actual = await vi.importActual('../src/api/home')
  return {
    ...actual,
    fetchHomeBootstrap: vi.fn(() => Promise.resolve({
      settings: {
        author_name: 'Bootstrap Author',
        bio: '',
        avatar_url: '',
        hero_image: '',
        github_link: '',
        announcement: '',
        site_url: 'https://563118077.xyz',
        friend_links: '[]',
      },
      home_modules: {
        hero: { image: '', image_alt: 'hero', preset: 'site_hero', art_direction_version: 'v1' },
        featured_series: [],
        latest_daily: [],
        latest_weekly: [],
        topic_pulse: { title: 'pulse', description: '', items: [] },
        continue_reading: { title: 'continue', empty_hint: '', local_only: true, items: [] },
        subscription_cta: { title: 'cta', primary_to: '/feeds', secondary_to: '/feed.xml' },
      },
      posts: { items: [], total: 0, page: 1, page_size: 10 },
    })),
  }
})

function Probe() {
  const { settings, loading, bootstrap } = useSite()

  return (
    <div>
      <span data-testid="loading">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="author">{settings?.author_name || 'none'}</span>
      <span data-testid="bootstrap">{bootstrap?.posts?.page_size || 0}</span>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  delete window.__BLOG_BOOTSTRAP__
})

it('uses the aggregated home bootstrap on the homepage and skips health prewarm', async () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <SiteProvider>
        <Probe />
      </SiteProvider>
    </MemoryRouter>,
  )

  await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('ready'))
  expect(screen.getByTestId('author')).toHaveTextContent('Bootstrap Author')
  expect(screen.getByTestId('bootstrap')).toHaveTextContent('10')
  expect(fetchHomeBootstrap).toHaveBeenCalledTimes(1)
  expect(apiGet).not.toHaveBeenCalledWith('/api/health', expect.anything())
  expect(apiGet).not.toHaveBeenCalledWith('/api/settings', expect.anything())
})
