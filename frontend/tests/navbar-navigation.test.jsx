import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Navbar from '../src/components/Navbar'
import Footer from '../src/components/Footer'
import { openCommandPalette } from '../src/utils/uiEvents'

vi.mock('../src/utils/uiEvents', () => ({ openCommandPalette: vi.fn() }))

vi.mock('../src/contexts/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggleTheme: vi.fn() }),
}))

vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({ user: null }),
}))

vi.mock('../src/utils/topicRetention', () => ({
  getContinueReadingItems: () => [],
  getFollowedTopics: () => [],
  getRecentTopics: () => [],
}))

const BROWSE_LINKS = [
  ['日报', '/daily'],
  ['周报', '/weekly'],
  ['系列', '/series'],
  ['主题', '/topics'],
  ['订阅', '/feeds'],
  ['归档', '/archive'],
  ['标签', '/tags'],
  ['友链', '/friends'],
]

function renderNavbar(entry = '/') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Navbar />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Navbar navigation', () => {
  it('exposes the newspaper masthead, primary sections, and subscription entry', () => {
    renderNavbar()

    const header = screen.getByRole('banner')
    expect(header).toHaveAttribute('data-surface', 'editorial')
    expect(within(header).getByText('AI OBSERVER')).toBeInTheDocument()
    expect(within(header).getByRole('link', { name: 'AI 资讯观察首页' })).toHaveAttribute('href', '/')
    const navigation = within(header).getByRole('navigation', { name: '主导航' })
    for (const [name, href] of BROWSE_LINKS.slice(0, 4)) {
      expect(within(navigation).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(within(header).getByRole('link', { name: '订阅更新' })).toHaveAttribute('href', '/feeds')
    expect(within(navigation).getByRole('link', { name: '首页' })).toHaveAttribute('aria-current', 'page')
  })

  it('removes the public paper surface on unmount while preserving the chosen theme', () => {
    const previousTheme = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', 'dark')
    const { unmount } = renderNavbar()

    expect(document.body).toHaveClass('public-news-shell')
    unmount()
    expect(document.body).not.toHaveClass('public-news-shell')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')

    if (previousTheme === null) document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', previousTheme)
  })

  it('keeps the parent news section active while reading a topic detail', () => {
    renderNavbar('/topics/model-updates')
    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(within(navigation).getByRole('link', { name: '主题' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('link', { name: '首页' })).not.toHaveAttribute('aria-current')
  })

  it('keeps account surfaces outside the public newspaper token scope', () => {
    renderNavbar('/account')
    expect(document.body).not.toHaveClass('public-news-shell')
  })

  it('shows the desktop browse menu with every secondary destination', async () => {
    renderNavbar()
    const trigger = document.querySelector('[data-ui="desktop-browse-trigger"]')

    await userEvent.click(trigger)

    const menu = document.querySelector('[data-ui="browse-dropdown"]')
    expect(menu).not.toBeNull()
    for (const [label, href] of BROWSE_LINKS) {
      expect(within(menu).getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
  })

  it('closes a pinned desktop browse menu on click and Escape', async () => {
    renderNavbar()
    const trigger = document.querySelector('[data-ui="desktop-browse-trigger"]')

    await userEvent.click(trigger)
    expect(document.querySelector('[data-ui="browse-dropdown"]')).not.toBeNull()
    await userEvent.click(trigger)
    expect(document.querySelector('[data-ui="browse-dropdown"]')).toBeNull()

    await userEvent.click(trigger)
    const dailyLink = within(document.querySelector('[data-ui="browse-dropdown"]')).getByRole('link', { name: '日报' })
    dailyLink.focus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-ui="browse-dropdown"]')).toBeNull()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('keeps the primary links and exposes the desktop search entry', () => {
    renderNavbar()

    expect(screen.getAllByRole('link', { name: '首页' })[0]).toHaveAttribute('href', '/')
    expect(screen.getAllByRole('link', { name: '开始阅读' })[0]).toHaveAttribute('href', '/start-here')
    expect(screen.getByRole('link', { name: '搜索' })).toHaveAttribute('href', '/search')
  })

  it('opens the mobile menu and expands the mobile browse destinations', async () => {
    renderNavbar()

    await userEvent.click(screen.getByRole('button', { name: '菜单' }))
    expect(screen.getByRole('button', { name: '菜单' })).toHaveAttribute('aria-expanded', 'true')
    const quickLinks = document.querySelector('[data-ui="mobile-quick-links"]')
    expect(within(quickLinks).getByRole('link', { name: '搜索' })).toHaveAttribute('href', '/search')
    expect(within(quickLinks).getByRole('link', { name: '登录' })).toHaveAttribute('href', '/login')
    const mobileTrigger = document.querySelector('[data-ui="mobile-browse-trigger"]')
    expect(mobileTrigger).not.toBeNull()
    expect(document.querySelector('[data-ui="mobile-browse-links"]')).toBeNull()

    await userEvent.click(mobileTrigger)

    const links = document.querySelector('[data-ui="mobile-browse-links"]')
    expect(links).not.toBeNull()
    for (const [label, href] of BROWSE_LINKS) {
      expect(within(links).getByRole('link', { name: label })).toHaveAttribute('href', href)
    }

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-ui="mobile-browse-trigger"]')).toBeNull()
    expect(screen.getByRole('button', { name: '菜单' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '菜单' })).toHaveFocus()
  })
})

describe('Newspaper footer', () => {
  it('links to the news archive, subscriptions and RSS without claiming live updates', async () => {
    render(<MemoryRouter><Footer /></MemoryRouter>)

    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('navigation', { name: '页脚导航' })).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: '全部归档' })).toHaveAttribute('href', '/archive')
    expect(within(footer).getByRole('link', { name: '订阅中心' })).toHaveAttribute('href', '/feeds')
    expect(within(footer).getByRole('link', { name: 'RSS' })).toHaveAttribute('href', '/feed.xml')
    expect(footer).not.toHaveTextContent(/Signal online|LIVE SIGNAL/)

    const callsBefore = vi.mocked(openCommandPalette).mock.calls.length
    await userEvent.click(within(footer).getByRole('button', { name: '搜索文章与主题' }))
    expect(openCommandPalette).toHaveBeenCalledTimes(callsBefore + 1)
  })
})
