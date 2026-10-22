import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Navbar from '../src/components/Navbar'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { initializeNewsStyle } from '../src/hooks/useNewsStyle'

vi.mock('../src/contexts/UserContext', () => ({ useUser: () => ({ user: null }) }))
vi.mock('../src/utils/topicRetention', () => ({
  getContinueReadingItems: () => [], getFollowedTopics: () => [], getRecentTopics: () => [],
}))

function renderNav(path = '/', navbarProps = {}) {
  return render(<MemoryRouter initialEntries={[path]}><ThemeProvider><Navbar {...navbarProps} /></ThemeProvider></MemoryRouter>)
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem('theme', 'light')
  document.documentElement.dataset.theme = 'light'
  delete document.documentElement.dataset.newsStyle
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
  window.dispatchEvent(new StorageEvent('storage', { key: null }))
  delete document.documentElement.dataset.newsStyle
})

it('defaults to tech without changing the global light theme or showing an ineffective theme control', () => {
  initializeNewsStyle()
  renderNav()

  expect(document.documentElement).toHaveAttribute('data-news-style', 'tech')
  expect(screen.getByRole('button', { name: '科技版' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: '切换主题' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem('theme')).toBe('light')
  expect(screen.getByRole('banner')).not.toHaveTextContent(/LIVE|实时更新/)
})

it('persists the comparison choice across navigation and remounts', async () => {
  const { unmount } = renderNav()
  await userEvent.click(screen.getByRole('button', { name: '报刊版' }))
  expect(window.localStorage.getItem('news-style')).toBe('paper')
  expect(document.documentElement).toHaveAttribute('data-news-style', 'paper')
  await userEvent.click(screen.getByRole('link', { name: '主题', exact: true }))
  expect(screen.getByRole('button', { name: '报刊版' })).toHaveAttribute('aria-pressed', 'true')
  unmount()
  renderNav('/topics')
  expect(screen.getByRole('button', { name: '报刊版' })).toHaveAttribute('aria-pressed', 'true')
})

it('preserves the paper theme preference when switching through tech', async () => {
  window.localStorage.setItem('theme', 'dark')
  window.localStorage.setItem('news-style', 'paper')
  renderNav()
  expect(screen.getByRole('button', { name: '切换主题' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: '科技版' }))
  expect(screen.queryByRole('button', { name: '切换主题' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem('theme')).toBe('dark')
  await userEvent.click(screen.getByRole('button', { name: '报刊版' }))
  expect(screen.getByRole('button', { name: '切换主题' })).toHaveAttribute('aria-pressed', 'true')
})

it('keeps the visual comparison out of private account surfaces', () => {
  renderNav('/account', { immersive: true })
  expect(document.body).not.toHaveClass('public-news-shell')
  expect(screen.queryByRole('group', { name: '新闻页面风格' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '切换主题' })).toBeInTheDocument()
  expect(screen.getByRole('banner')).not.toHaveClass('news-navbar--immersive')
})

it('uses an immersive header only for the public edition and restores paper navigation on comparison', async () => {
  renderNav('/', { immersive: true })
  expect(screen.getByRole('banner')).toHaveClass('news-navbar--immersive')
  await userEvent.click(screen.getByRole('button', { name: '报刊版' }))
  expect(screen.getByRole('banner')).not.toHaveClass('news-navbar--immersive')
  expect(window.localStorage.getItem('theme')).toBe('light')
})

it('synchronizes a style change from another tab', async () => {
  renderNav()
  window.localStorage.setItem('news-style', 'paper')
  window.dispatchEvent(new StorageEvent('storage', { key: 'news-style', newValue: 'paper' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '报刊版' })).toHaveAttribute('aria-pressed', 'true'))
  expect(document.documentElement).toHaveAttribute('data-news-style', 'paper')
})

it('still switches when browser privacy settings reject storage writes', async () => {
  renderNav()
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
  await userEvent.click(screen.getByRole('button', { name: '报刊版' }))
  expect(document.documentElement).toHaveAttribute('data-news-style', 'paper')
  expect(screen.getByRole('button', { name: '报刊版' })).toHaveAttribute('aria-pressed', 'true')
})
