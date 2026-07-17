import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import Navbar from '../src/components/Navbar'

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

function renderNavbar() {
  return render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Navbar navigation', () => {
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
