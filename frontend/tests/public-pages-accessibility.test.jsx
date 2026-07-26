import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

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

let Navbar
let PageTransition

beforeEach(async () => {
  vi.resetModules()
  Navbar = (await import('../src/components/Navbar')).default
  PageTransition = (await import('../src/components/PageTransition')).default
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-ui="route-announcer-host"]').forEach((node) => node.remove())
})

describe('Navbar disclosure semantics', () => {
  it('flips the browse trigger label between open and closed and wires aria-controls', async () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    const trigger = document.querySelector('[data-ui="desktop-browse-trigger"]')

    expect(trigger).toHaveAttribute('aria-label', '打开浏览菜单')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId)).toBeNull()

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-label', '关闭浏览菜单')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(panelId)).toBe(document.querySelector('[data-ui="browse-dropdown"]'))
  })

  it('flips the tracking trigger label and points at the tracking panel', async () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    const trigger = document.querySelector('[data-ui="desktop-tracking-trigger"]')

    expect(trigger).toHaveAttribute('aria-label', '打开追踪面板')
    const panelId = trigger.getAttribute('aria-controls')

    await userEvent.click(trigger)

    expect(trigger).toHaveAttribute('aria-label', '关闭追踪面板')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(panelId)).toBe(document.querySelector('[data-ui="tracking-dropdown"]'))
  })

  it('keeps the mobile toggles stateful without breaking the icon-only menu name', async () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    const menuButton = screen.getByRole('button', { name: '菜单' })
    expect(menuButton).toHaveAttribute('aria-controls', 'navbar-mobile-panel')

    await userEvent.click(menuButton)
    expect(document.getElementById('navbar-mobile-panel')).not.toBeNull()

    const browseTrigger = document.querySelector('[data-ui="mobile-browse-trigger"]')
    expect(browseTrigger).toHaveAttribute('aria-label', '打开浏览菜单')
    await userEvent.click(browseTrigger)
    expect(browseTrigger).toHaveAttribute('aria-label', '关闭浏览菜单')
    expect(document.getElementById(browseTrigger.getAttribute('aria-controls'))).not.toBeNull()
  })
})

function RouteProbe({ label }) {
  const location = useLocation()
  return (
    <main>
      <h1>{label}</h1>
      <span data-testid="path">{location.pathname}</span>
    </main>
  )
}

function TransitionHarness() {
  const location = useLocation()
  return (
    <PageTransition key={location.pathname}>
      <Routes location={location}>
        <Route path="/" element={<RouteProbe label="首页正文" />} />
        <Route path="/next" element={<RouteProbe label="下一页正文" />} />
      </Routes>
    </PageTransition>
  )
}

describe('PageTransition route focus and announcements', () => {
  it('leaves focus alone on first paint but moves it to #main-content after navigation', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Link to="/next">前往下一页</Link>
        <TransitionHarness />
      </MemoryRouter>,
    )

    expect(document.activeElement).toBe(document.body)

    await userEvent.click(screen.getByRole('link', { name: '前往下一页' }))
    await screen.findByText('下一页正文')

    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main-content')))
    expect(document.getElementById('main-content')).toHaveAttribute('tabindex', '-1')
  })

  it('announces the new document title through a persistent polite live region', async () => {
    document.title = '第一页 - AI 资讯观察'
    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <TransitionHarness />
      </MemoryRouter>,
    )

    const announcer = document.querySelector('[data-ui="route-announcer"]')
    expect(announcer).not.toBeNull()
    expect(announcer).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(announcer).toHaveTextContent('第一页 - AI 资讯观察'))

    document.title = '第二页 - AI 资讯观察'
    await waitFor(() => expect(
      document.querySelector('[data-ui="route-announcer"]'),
    ).toHaveTextContent('第二页 - AI 资讯观察'))

    // 播报宿主必须在路由子树之外常驻，否则读屏软件读不到重建后的 live region。
    const host = document.querySelector('[data-ui="route-announcer-host"]')
    expect(host?.parentElement).toBe(document.body)
    unmount()
    expect(document.querySelector('[data-ui="route-announcer-host"]')).toBe(host)
  })
})
