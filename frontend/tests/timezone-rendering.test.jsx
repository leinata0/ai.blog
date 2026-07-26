/**
 * Timestamps must render in the viewer's timezone, not 8 hours early.
 *
 * `utils/date.parseDate` is the single parser: it reads a timezone-less backend string as
 * UTC and leaves marked ones alone. Pages that bypassed it with a bare `new Date(value)`
 * (账号中心 / 关注 / 归档 / 后台面板) showed every timestamp shifted by the local offset, and
 * 归档 grouped by the UTC calendar day, so a UTC-evening post landed under the wrong date.
 *
 * Every case here runs in Asia/Shanghai (UTC+8) — in UTC the bug is invisible.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { ThemeProvider } from '../src/contexts/ThemeContext'

const mocks = vi.hoisted(() => ({
  currentUser: null,
  fetchArchive: vi.fn(),
  fetchCloudTopics: vi.fn(),
  fetchCloudHistory: vi.fn(),
  fetchAccountDashboard: vi.fn(),
  fetchAccountLibrary: vi.fn(),
  fetchAdminTopicHealth: vi.fn(),
  fetchAdminTopicProfiles: vi.fn(),
  fetchAdminCoverGenerationStatus: vi.fn(),
  probeAdminEndpointHealth: vi.fn(),
  fetchAdminSubscriptionHealth: vi.fn(),
}))

vi.mock('../src/api/posts', () => ({ fetchArchive: mocks.fetchArchive }))
vi.mock('../src/components/Navbar', () => ({ default: () => null }))
vi.mock('../src/contexts/UserContext', () => ({
  useUser: () => ({
    user: mocks.currentUser,
    loading: false,
    logout: vi.fn(),
    setUser: vi.fn(),
    revokeAllSessions: vi.fn(),
    retrySync: vi.fn(),
    syncState: 'idle',
  }),
}))
vi.mock('../src/api/user', () => ({
  fetchCloudTopics: mocks.fetchCloudTopics,
  fetchCloudHistory: mocks.fetchCloudHistory,
  fetchAccountDashboard: mocks.fetchAccountDashboard,
  fetchAccountLibrary: mocks.fetchAccountLibrary,
  fetchAccountExport: vi.fn(() => Promise.resolve({})),
  updateMe: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  changePassword: vi.fn(),
  clearCloudHistory: vi.fn(),
  removeHistoryEntry: vi.fn(),
  removeAccountLike: vi.fn(),
  removeAccountComment: vi.fn(),
  resendVerification: vi.fn(),
  revokeSessions: vi.fn(),
  unfollowTopicCloud: vi.fn(),
  deleteAccount: vi.fn(),
}))
vi.mock('../src/api/admin', () => ({
  fetchAdminTopicHealth: mocks.fetchAdminTopicHealth,
  fetchAdminTopicProfiles: mocks.fetchAdminTopicProfiles,
  fetchAdminCoverGenerationStatus: mocks.fetchAdminCoverGenerationStatus,
  createAdminTopicProfile: vi.fn(),
  updateAdminTopicProfile: vi.fn(),
  generateAdminTopicProfileCover: vi.fn(),
  waitForAdminImageGenerationJob: vi.fn(),
  probeAdminEndpointHealth: mocks.probeAdminEndpointHealth,
  fetchAdminSubscriptionHealth: mocks.fetchAdminSubscriptionHealth,
}))

// Node re-reads process.env.TZ on every Date/Intl operation, so this really does move the
// whole suite off UTC — where every assertion below would pass even with the bug present.
beforeEach(() => {
  vi.stubEnv('TZ', 'Asia/Shanghai')
  vi.clearAllMocks()
  mocks.currentUser = null
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

// ── 归档：day + year grouping ─────────────────────

describe('ArchivePage grouping in UTC+8', () => {
  async function renderArchive(posts) {
    mocks.fetchArchive.mockResolvedValue([{ year: '2026', posts }])
    const { default: ArchivePage } = await import('../src/pages/ArchivePage')
    return render(
      <MemoryRouter>
        <ThemeProvider>
          <ArchivePage />
        </ThemeProvider>
      </MemoryRouter>,
    )
  }

  it('files a UTC-evening post under the reader’s calendar day', async () => {
    // 2026-07-25T23:30Z is already 2026-07-26 07:30 in Shanghai. Slicing the ISO string
    // (the old behaviour) bucketed it under 07-25 — a whole day early.
    const { container } = await renderArchive([
      { title: '深夜发布的模型更新', slug: 'late-night', created_at: '2026-07-25T23:30:00+00:00', content_type: 'daily_brief' },
    ])

    expect(await screen.findByText('深夜发布的模型更新')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-07-26"]')).toBeTruthy()
    expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-07-25"]')).toBeNull()
    // Both the day-group heading and the post's own date read 07/26.
    expect(screen.getAllByText('07/26')).toHaveLength(2)
    expect(screen.queryByText('07/25')).toBeNull()
  })

  it('accepts a timezone-less created_at as UTC', async () => {
    const { container } = await renderArchive([
      { title: '无时区标记', slug: 'naive', created_at: '2026-07-25T23:30:00', content_type: 'daily_brief' },
    ])

    expect(await screen.findByText('无时区标记')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-07-26"]')).toBeTruthy()
  })

  it('keeps the year heading and the day group on the same side of a year boundary', async () => {
    // 2025-12-31T23:30Z is 2026-01-01 in Shanghai: heading and day group must agree.
    const { container } = await renderArchive([
      { title: '跨年发布', slug: 'new-year', created_at: '2025-12-31T23:30:00+00:00', content_type: 'daily_brief' },
    ])

    expect(await screen.findByText('跨年发布')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="archive-day-group"]').getAttribute('data-date')).toBe('2026-01-01')
    expect(screen.getByRole('heading', { level: 2, name: /2026/ })).toBeInTheDocument()
  })

  it('honours coverage_date verbatim as an editorial calendar day', async () => {
    const { container } = await renderArchive([
      { title: '带覆盖日期', slug: 'covered', created_at: '2026-07-25T23:30:00+00:00', coverage_date: '2026-07-25', content_type: 'daily_brief' },
    ])

    expect(await screen.findByText('带覆盖日期')).toBeInTheDocument()
    expect(container.querySelector('[data-ui="archive-day-group"][data-date="2026-07-25"]')).toBeTruthy()
    // A date-only value names a calendar day, so its label is pinned to UTC and reads back
    // as the day it names in every timezone.
    expect(screen.getByText('07/25')).toBeInTheDocument()
  })
})

// ── 关注页 ────────────────────────────────────────

describe('FollowingPage in UTC+8', () => {
  it('dates a follow recorded late UTC as the next local day', async () => {
    window.localStorage.setItem('blog.followed_topics', JSON.stringify([
      { topic_key: 'agents', display_title: '智能体', followed_at: '2026-07-25T23:30:00' },
    ]))
    const { default: FollowingPage } = await import('../src/pages/FollowingPage')

    render(
      <MemoryRouter>
        <ThemeProvider>
          <FollowingPage />
        </ThemeProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('关注于 2026/07/26')).toBeInTheDocument()
  })
})

// ── 账号中心 ──────────────────────────────────────

describe('AccountPage in UTC+8', () => {
  it('renders history and last-login timestamps in local time', async () => {
    mocks.currentUser = {
      email: 'u@example.com', nickname: 'Me', bio: '', avatar_url: '', email_verified: true,
      password_set: true, created_at: '2026-01-01T00:00:00Z', last_login_at: '2026-07-25T23:30:00+00:00',
    }
    mocks.fetchAccountDashboard.mockResolvedValue({
      counts: { following: 0, history: 1, comments: 0, likes: 0 },
      recent_history: [{
        kind: 'history', id: 'recent', slug: 'recent', title: '深夜读过的文章', summary: '',
        content_type: 'post', occurred_at: '2026-07-25T23:30:00+00:00', available: true,
      }],
      followed_updates: [],
      security: { email_verified: true, password_set: true, last_login_at: '2026-07-25T23:30:00+00:00' },
    })
    mocks.fetchAccountLibrary.mockResolvedValue({ kind: 'all', total: 0, page: 1, page_size: 20, items: [] })
    const { default: AccountPage } = await import('../src/pages/AccountPage')

    function renderAccount(entry) {
      return render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes><Route path="*" element={<AccountPage />} /></Routes>
        </MemoryRouter>,
      )
    }

    renderAccount('/account?tab=overview')
    expect(await screen.findByText('深夜读过的文章')).toBeInTheDocument()
    // 2026-07-25T23:30Z is 2026年7月26日 07:30 in Shanghai; the bare new Date() showed 7月25日.
    expect(screen.getByText('2026年7月26日')).toBeInTheDocument()
    expect(screen.queryByText('2026年7月25日')).toBeNull()

    cleanup()
    renderAccount('/account?tab=security')
    expect(await screen.findByText('2026年7月26日 07:30')).toBeInTheDocument()
  })
})

// ── 后台面板 ──────────────────────────────────────

describe('Admin panels in UTC+8', () => {
  it('AdminTopicHealth dates latest_post_at in local time', async () => {
    mocks.fetchAdminTopicHealth.mockResolvedValue({
      summary: {},
      items: [{ topic_key: 'agents', display_title: '智能体', post_count: 3, latest_post_at: '2026-07-25T23:30:00+00:00' }],
    })
    const { default: AdminTopicHealth } = await import('../src/components/admin/AdminTopicHealth')

    render(<AdminTopicHealth />)

    expect(await screen.findByText('最近更新 2026/07/26')).toBeInTheDocument()
  })

  it('AdminTopicProfiles dates latest_post_at in local time', async () => {
    mocks.fetchAdminTopicProfiles.mockResolvedValue([{
      id: 1, topic_key: 'agents', display_title: '智能体', title: '智能体', description: '',
      aliases: [], focus_points: [], content_types: [], post_count: 3, source_count: 2,
      profile_exists: true, latest_post_at: '2026-07-25T23:30:00+00:00',
    }])
    mocks.fetchAdminCoverGenerationStatus.mockResolvedValue({ provider: 'grok', can_generate: false, message: '' })
    const { default: AdminTopicProfiles } = await import('../src/components/admin/AdminTopicProfiles')
    const { ConfirmProvider } = await import('../src/components/ui/ConfirmDialog')

    render(<ConfirmProvider><AdminTopicProfiles /></ConfirmProvider>)

    expect(await screen.findByText(/最近更新时间：2026\/7\/26 07:30:00/)).toBeInTheDocument()
  })

  it('AdminEndpointHealth dates the probe timestamps in local time', async () => {
    mocks.probeAdminEndpointHealth.mockResolvedValue({
      checked_at: '2026-07-25T23:30:00+00:00',
      overview: { total: 1, ok: 1, slow: 0, failed: 0 },
      items: [{
        key: 'posts', label: '文章列表', path: '/api/posts', ok: true, status: 'ok',
        status_code: 200, duration_ms: 12, checked_at: '2026-07-25T23:30:00+00:00', summary: '',
      }],
    })
    mocks.fetchAdminSubscriptionHealth.mockResolvedValue({})
    const { default: AdminEndpointHealth } = await import('../src/components/admin/AdminEndpointHealth')

    render(<AdminEndpointHealth />)

    expect(await screen.findByText(/最近检查时间：2026\/7\/26 07:30:00/)).toBeInTheDocument()
    expect(screen.getByText('07:30:00')).toBeInTheDocument()
  })
})
