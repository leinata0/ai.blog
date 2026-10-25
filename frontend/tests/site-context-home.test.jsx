import { act, render, screen } from '@testing-library/react'
import { Link, MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SiteProvider, useSite } from '../src/contexts/SiteContext'
import { fetchPublicHome } from '../src/api/publicHome'
import { createPublicHomeSnapshot } from '../src/utils/publicHomeSnapshot'
import { saveHomeBootstrap } from '../src/utils/homeBootstrap'
import { apiGet } from '../src/api/client'

vi.mock('../src/api/publicHome', () => ({ fetchPublicHome: vi.fn() }))
vi.mock('../src/api/client', () => ({ apiGet: vi.fn(async () => ({ author_name: 'Fallback author' })), apiPost: vi.fn(), apiPrefetchGet: vi.fn() }))
const snapshot = () => createPublicHomeSnapshot({ settings: { author_name: 'Home author' }, posts: { items: [{ slug: 'live', title: 'Verified home story' }], total: 1 }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] })
function Probe() {
  const value = useSite()
  return <><output data-testid="managed">{String(value.homeDataManaged)}</output><output data-testid="story">{value.bootstrap?.posts.items[0]?.title || 'none'}</output><output data-testid="author">{value.settings?.author_name || 'none'}</output><output data-testid="loading">{String(value.bootstrapLoading)}</output><output data-testid="error">{value.bootstrapError}</output><Link to="/archive">archive</Link><Link to="/">home</Link></>
}
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })
afterEach(() => { vi.useRealTimers(); delete window.__BLOG_HOME_BOOTSTRAP__; delete window.__BLOG_BOOTSTRAP__ })

it('retains verified homepage content across routes without replaying the build', async () => {
  fetchPublicHome.mockImplementationOnce(async () => saveHomeBootstrap(snapshot())).mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter><SiteProvider><Probe /></SiteProvider></MemoryRouter>)
  await screen.findByText('Verified home story')
  act(() => screen.getByRole('link', { name: 'archive' }).click())
  expect(screen.getByTestId('story')).toHaveTextContent('Verified home story')
  act(() => screen.getByRole('link', { name: 'home' }).click())
  expect(screen.getByTestId('story')).toHaveTextContent('Verified home story')
  expect(screen.getByTestId('loading')).toHaveTextContent('false')
  expect(screen.getByTestId('managed')).toHaveTextContent('true')
})

it('does not request home data on other routes or filtered home queries', () => {
  fetchPublicHome.mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter initialEntries={['/?q=search']}><SiteProvider><Probe /></SiteProvider></MemoryRouter>)
  expect(fetchPublicHome).not.toHaveBeenCalled()
  expect(screen.getByTestId('managed')).toHaveTextContent('true')
})

it('ends home timeout without blocking on settings or discarding the known identity', async () => {
  vi.useFakeTimers()
  const built = snapshot()
  window.__BLOG_HOME_BOOTSTRAP__ = { ...built, generatedAt: new Date(Date.now() - 3600000).toISOString() }
  fetchPublicHome.mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter><SiteProvider><Probe /></SiteProvider></MemoryRouter>)
  expect(screen.getByTestId('author')).toHaveTextContent('Home author')
  await act(async () => vi.advanceTimersByTime(8000))
  expect(screen.getByTestId('loading')).toHaveTextContent('false')
  expect(screen.getByTestId('story')).toHaveTextContent('none')
  expect(screen.getByTestId('error')).toHaveTextContent('请重试')
  expect(screen.getByTestId('author')).toHaveTextContent('Home author')
  expect(apiGet.mock.calls.some(([path]) => path === '/api/settings')).toBe(false)
})

it('ends a no-bootstrap timeout before the independent settings fallback settles', async () => {
  vi.useFakeTimers()
  apiGet.mockImplementation(() => new Promise(() => {}))
  fetchPublicHome.mockImplementation(() => new Promise(() => {}))
  render(<MemoryRouter><SiteProvider><Probe /></SiteProvider></MemoryRouter>)
  expect(screen.getByTestId('loading')).toHaveTextContent('true')
  await act(async () => vi.advanceTimersByTime(8000))
  expect(screen.getByTestId('loading')).toHaveTextContent('false')
  expect(screen.getByTestId('error')).toHaveTextContent('请重试')
  expect(apiGet).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ timeout: 8000 }))
  expect(fetchPublicHome).toHaveBeenCalledOnce()
})
