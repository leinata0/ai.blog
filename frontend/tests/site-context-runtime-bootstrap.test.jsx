import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom'

import { SiteProvider, useSite } from '../src/contexts/SiteContext'
import { fetchHomeBootstrap } from '../src/api/home'

vi.mock('../src/api/client', () => ({
  apiGet: vi.fn(() => Promise.resolve({})),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}))

vi.mock('../src/api/home', async () => {
  const actual = await vi.importActual('../src/api/home')
  return { ...actual, fetchHomeBootstrap: vi.fn() }
})

function settingsPayload(authorName) {
  return {
    author_name: authorName,
    bio: '',
    avatar_url: '',
    hero_image: '',
    github_link: '',
    announcement: '',
    site_url: 'https://www.563118077.xyz',
    friend_links: '[]',
  }
}

function Probe() {
  const { settings, bootstrap } = useSite()
  const firstPost = bootstrap?.posts?.items?.[0]
  return (
    <div>
      <span data-testid="author">{settings?.author_name || 'none'}</span>
      <span data-testid="tags">{Array.isArray(firstPost?.tags) ? `array:${firstPost.tags.length}` : typeof firstPost?.tags}</span>
      <span data-testid="content-type">{String(firstPost?.content_type)}</span>
      <span data-testid="total">{String(bootstrap?.posts?.total)}</span>
      <Link to="/archive">去归档</Link>
      <Link to="/">回首页</Link>
    </div>
  )
}

function App() {
  return (
    <SiteProvider>
      <Routes>
        <Route path="/" element={<Probe />} />
        <Route path="/archive" element={<Probe />} />
      </Routes>
    </SiteProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  delete window.__BLOG_BOOTSTRAP__
})

afterEach(() => {
  cleanup()
})

it('normalizes the build-time bootstrap instead of handing raw backend JSON to consumers', async () => {
  window.__BLOG_BOOTSTRAP__ = {
    settings: { author_name: 'Runtime Author', site_url: 'https://www.563118077.xyz' },
    posts: {
      // Raw prerender payload: no tags array, unknown content_type, missing total.
      items: [{ title: 'Latest', slug: 'latest', content_type: 'something_else' }],
    },
  }
  fetchHomeBootstrap.mockImplementation(() => new Promise(() => {}))

  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)

  await waitFor(() => expect(screen.getByTestId('author')).toHaveTextContent('Runtime Author'))
  // Same contract as the API path (normalizePostList / normalizeSettings).
  expect(screen.getByTestId('tags')).toHaveTextContent('array:0')
  expect(screen.getByTestId('content-type')).toHaveTextContent('null')
  expect(screen.getByTestId('total')).toHaveTextContent('0')
})

it('consumes the build-time bootstrap once instead of re-applying it on every return to /', async () => {
  window.__BLOG_BOOTSTRAP__ = {
    settings: settingsPayload('Runtime Author'),
    posts: { items: [], total: 0, page: 1, page_size: 10 },
  }

  let call = 0
  fetchHomeBootstrap.mockImplementation(() => {
    call += 1
    if (call === 1) {
      return Promise.resolve({
        settings: settingsPayload('Fresh Author'),
        home_modules: {},
        posts: { items: [], total: 0, page: 1, page_size: 10 },
      })
    }
    // Later revalidations stay pending, so anything rendered now comes from state.
    return new Promise(() => {})
  })

  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('author')).toHaveTextContent('Fresh Author'))

  await userEvent.click(screen.getByRole('link', { name: '去归档' }))
  await userEvent.click(screen.getByRole('link', { name: '回首页' }))

  // Build-time data must not overwrite live state again — that is the "SPA opened all
  // day keeps flashing yesterday's list" bug.
  expect(screen.getByTestId('author')).toHaveTextContent('Fresh Author')
  await waitFor(() => expect(screen.getByTestId('author')).toHaveTextContent('Fresh Author'))
})
