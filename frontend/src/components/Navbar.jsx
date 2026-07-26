import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Clock3,
  Command,
  Compass,
  Menu,
  Moon,
  PanelsTopLeft,
  Search,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react'

import GlassPopover from './GlassPopover'
import { useTheme } from '../contexts/ThemeContext'
import { useUser } from '../contexts/UserContext'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'
import { SITE_COPY } from '../utils/contentPresentation'
import { openCommandPalette } from '../utils/uiEvents'

const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '开始阅读', to: '/start-here' },
]

const BROWSE_ITEMS = [
  { label: '日报', to: '/daily' },
  { label: '周报', to: '/weekly' },
  { label: '系列', to: '/series' },
  { label: '主题', to: '/topics' },
  { label: '订阅', to: '/feeds' },
  { label: '归档', to: '/archive' },
  { label: '标签', to: '/tags' },
  { label: '友链', to: '/friends' },
]

const TRACKING_CLOSE_DELAY_MS = 220
const BROWSE_CLOSE_DELAY_MS = 220

// 展开/收起类按钮的可访问名必须随状态变化，"打开…"在已展开时是错的。
const BROWSE_PANEL_ID = 'navbar-browse-panel'
const TRACKING_PANEL_ID = 'navbar-tracking-panel'
const MOBILE_NAV_PANEL_ID = 'navbar-mobile-panel'
const MOBILE_BROWSE_PANEL_ID = 'navbar-mobile-browse-panel'
const MOBILE_TRACKING_PANEL_ID = 'navbar-mobile-tracking-panel'

function toggleLabel(open, name) {
  return `${open ? '关闭' : '打开'}${name}`
}

function NavLink({ to, active, children, onClick }) {
  const className = 'relative pb-1 text-sm font-semibold transition-colors duration-200 group'
  const style = { color: active ? 'var(--accent)' : 'var(--text-secondary)' }

  return (
    <Link to={to} className={className} style={style} onClick={onClick}>
      {children}
      {active ? (
        <span className="absolute bottom-0 left-0 h-[2px] w-full rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
      ) : (
        <span
          className="absolute bottom-0 left-0 h-[2px] w-0 rounded-full transition-[width] duration-300 group-hover:w-full"
          style={{ backgroundColor: 'var(--accent)' }}
        />
      )}
    </Link>
  )
}

function TrackingSection({ icon: Icon, title, items, emptyText, renderItem }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-faint)' }}>
        <Icon size={14} />
        {title}
      </div>
      {items.length > 0 ? (
        <div className="mt-3 space-y-2">
          {items.map(renderItem)}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
          {emptyText}
        </p>
      )}
    </div>
  )
}

function TrackingCard({ to, onNavigate, title, description }) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className="block rounded-[1.1rem] border border-transparent px-3 py-3 transition-[border-color,background-color,transform] duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
    >
      <div className="line-clamp-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </div>
      <div className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
        {description}
      </div>
    </Link>
  )
}

function BrowsePreview({ pathname, onNavigate, id }) {
  return (
    <GlassPopover id={id} data-ui="browse-dropdown" className="w-[320px] p-3">
      <div className="grid grid-cols-2 gap-1">
        {BROWSE_ITEMS.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className="rounded-lg px-3 py-3 text-sm font-semibold transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
              style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </GlassPopover>
  )
}

function TrackingPreview({
  continueReading,
  followedTopics,
  recentTopics,
  onNavigate,
  id,
}) {
  return (
    <GlassPopover id={id} data-ui="tracking-dropdown" className="w-[388px] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="section-kicker">追踪</div>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            回到你刚才在看的文章和主题，快速继续这条阅读主线。
          </p>
        </div>
        <Link
          to="/following"
          onClick={onNavigate}
          className="section-action shrink-0"
        >
          查看追踪页
        </Link>
      </div>

      <div className="mt-5 space-y-4">
        <TrackingSection
          icon={BookOpen}
          title="继续阅读"
          items={continueReading}
          emptyText="读过的文章会出现在这里。"
          renderItem={(item) => (
            <TrackingCard
              key={item.slug}
              to={`/posts/${item.slug}`}
              onNavigate={onNavigate}
              title={item.title}
              description={item.topic_display_title || item.topic_key || '最近阅读'}
            />
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TrackingSection
            icon={Compass}
            title="最近关注"
            items={followedTopics}
            emptyText="关注的主题会出现在这里。"
            renderItem={(item) => (
              <TrackingCard
                key={item.topic_key}
                to={`/topics/${item.topic_key}`}
                onNavigate={onNavigate}
                title={item.display_title || item.topic_key}
                description="你已经关注的主题主线"
              />
            )}
          />

          <TrackingSection
            icon={Clock3}
            title="最近浏览"
            items={recentTopics}
            emptyText="最近浏览的主题会出现在这里。"
            renderItem={(item) => (
              <TrackingCard
                key={item.topic_key}
                to={`/topics/${item.topic_key}`}
                onNavigate={onNavigate}
                title={item.display_title || item.topic_key}
                description={`最近活跃：${new Date(item.latest_post_at || Date.now()).toLocaleDateString('zh-CN')}`}
              />
            )}
          />
        </div>
      </div>
    </GlassPopover>
  )
}

export default function Navbar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileBrowseOpen, setMobileBrowseOpen] = useState(false)
  const [mobileTrackingOpen, setMobileTrackingOpen] = useState(false)
  const [browseOpen, setBrowseOpen] = useState(false)
  const [browsePinned, setBrowsePinned] = useState(false)
  const [trackingOpen, setTrackingOpen] = useState(false)
  const [trackingPinned, setTrackingPinned] = useState(false)
  const [continueReading, setContinueReading] = useState([])
  const [followedTopics, setFollowedTopics] = useState([])
  const [recentTopics, setRecentTopics] = useState([])
  const browsePanelRef = useRef(null)
  const trackingPanelRef = useRef(null)
  const navRef = useRef(null)
  const browseTriggerRef = useRef(null)
  const trackingTriggerRef = useRef(null)
  const mobileMenuButtonRef = useRef(null)
  const mobilePanelRef = useRef(null)
  const browseCloseTimerRef = useRef(null)
  const trackingCloseTimerRef = useRef(null)
  const { dark, toggleTheme } = useTheme()
  const { user } = useUser()

  useEffect(() => {
    setMobileOpen(false)
    setMobileBrowseOpen(false)
    setMobileTrackingOpen(false)
    setBrowseOpen(false)
    setBrowsePinned(false)
    setTrackingOpen(false)
    setTrackingPinned(false)
  }, [location.pathname])

  useEffect(() => {
    function syncTrackingState() {
      setContinueReading(getContinueReadingItems(2))
      setFollowedTopics(getFollowedTopics().slice(0, 2))
      setRecentTopics(getRecentTopics(2))
    }

    syncTrackingState()
    window.addEventListener('focus', syncTrackingState)
    window.addEventListener('storage', syncTrackingState)

    return () => {
      window.removeEventListener('focus', syncTrackingState)
      window.removeEventListener('storage', syncTrackingState)
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!navRef.current?.contains(event.target)) {
        setMobileOpen(false)
        setMobileBrowseOpen(false)
        setMobileTrackingOpen(false)
      }
      if (!browsePanelRef.current?.contains(event.target)) {
        setBrowseOpen(false)
        setBrowsePinned(false)
      }
      if (!trackingPanelRef.current?.contains(event.target)) {
        setTrackingOpen(false)
        setTrackingPinned(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        const activeElement = document.activeElement
        const restoreBrowseFocus = browsePanelRef.current?.contains(activeElement)
        const restoreTrackingFocus = trackingPanelRef.current?.contains(activeElement)
        const restoreMobileFocus = mobilePanelRef.current?.contains(activeElement)
        if (restoreBrowseFocus) browseTriggerRef.current?.focus()
        if (restoreTrackingFocus) trackingTriggerRef.current?.focus()
        if (restoreMobileFocus) mobileMenuButtonRef.current?.focus()
        setBrowseOpen(false)
        setBrowsePinned(false)
        setTrackingOpen(false)
        setTrackingPinned(false)
        setMobileOpen(false)
        setMobileBrowseOpen(false)
        setMobileTrackingOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  useEffect(() => () => {
    if (browseCloseTimerRef.current) {
      window.clearTimeout(browseCloseTimerRef.current)
    }
    if (trackingCloseTimerRef.current) {
      window.clearTimeout(trackingCloseTimerRef.current)
    }
  }, [])

  const hasTrackingData = useMemo(
    () => continueReading.length > 0 || followedTopics.length > 0 || recentTopics.length > 0,
    [continueReading.length, followedTopics.length, recentTopics.length],
  )

  function clearBrowseCloseTimer() {
    if (browseCloseTimerRef.current) {
      window.clearTimeout(browseCloseTimerRef.current)
      browseCloseTimerRef.current = null
    }
  }

  function clearTrackingCloseTimer() {
    if (trackingCloseTimerRef.current) {
      window.clearTimeout(trackingCloseTimerRef.current)
      trackingCloseTimerRef.current = null
    }
  }

  function scheduleBrowseClose() {
    clearBrowseCloseTimer()
    browseCloseTimerRef.current = window.setTimeout(() => {
      if (!browsePinned) {
        setBrowseOpen(false)
      }
    }, BROWSE_CLOSE_DELAY_MS)
  }

  function scheduleTrackingClose() {
    clearTrackingCloseTimer()
    trackingCloseTimerRef.current = window.setTimeout(() => {
      if (!trackingPinned) {
        setTrackingOpen(false)
      }
    }, TRACKING_CLOSE_DELAY_MS)
  }

  function openBrowsePreview() {
    clearBrowseCloseTimer()
    clearTrackingCloseTimer()
    setTrackingOpen(false)
    setTrackingPinned(false)
    setBrowseOpen(true)
  }

  function openTrackingPreview() {
    clearTrackingCloseTimer()
    clearBrowseCloseTimer()
    setBrowseOpen(false)
    setBrowsePinned(false)
    setTrackingOpen(true)
  }

  function closeBrowse() {
    clearBrowseCloseTimer()
    setBrowseOpen(false)
    setBrowsePinned(false)
  }

  function closeTracking() {
    clearTrackingCloseTimer()
    setTrackingOpen(false)
    setTrackingPinned(false)
    setMobileOpen(false)
    setMobileTrackingOpen(false)
  }

  function handleBrowseButtonClick() {
    clearBrowseCloseTimer()
    clearTrackingCloseTimer()
    setTrackingOpen(false)
    setTrackingPinned(false)
    if (browseOpen && browsePinned) {
      setBrowseOpen(false)
      setBrowsePinned(false)
      return
    }
    setBrowseOpen(true)
    setBrowsePinned(true)
  }

  function handleTrackingButtonClick() {
    clearTrackingCloseTimer()
    clearBrowseCloseTimer()
    setBrowseOpen(false)
    setBrowsePinned(false)
    if (trackingOpen && trackingPinned) {
      setTrackingOpen(false)
      setTrackingPinned(false)
      return
    }
    setTrackingOpen(true)
    setTrackingPinned(true)
  }

  return (
    <nav
      ref={navRef}
      className="sticky top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300"
      style={{
        backgroundColor: dark ? 'rgba(10, 17, 29, 0.82)' : 'rgba(255, 255, 255, 0.78)',
        backdropFilter: 'blur(18px)',
        borderBottom: '1px solid var(--border-muted)',
        boxShadow: '0 10px 28px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div className="flex items-center justify-between px-6 sm:px-10 lg:px-20" style={{ minHeight: '72px' }}>
        <Link to="/" className="brand-lockup min-w-0">
          <span className="brand-lockup__mark" aria-hidden="true"><span /></span>
          <span className="min-w-0">
            <span className="brand-lockup__eyebrow" translate="no">SIGNAL DESK</span>
            <span className="brand-lockup__title">{SITE_COPY.brand}</span>
          </span>
        </Link>

        <div className="hidden items-center gap-4 lg:flex xl:gap-6">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} active={location.pathname === item.to}>
              {item.label}
            </NavLink>
          ))}

          <div
            ref={browsePanelRef}
            className="relative"
            onMouseEnter={openBrowsePreview}
            onMouseLeave={() => {
              if (!browsePinned) scheduleBrowseClose()
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closeBrowse()
            }}
          >
            <button
              ref={browseTriggerRef}
              type="button"
              data-ui="desktop-browse-trigger"
              onClick={handleBrowseButtonClick}
              onFocus={openBrowsePreview}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-200"
              style={{
                backgroundColor: browseOpen ? 'var(--accent-soft)' : 'transparent',
                color: browseOpen ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              aria-label={toggleLabel(browseOpen, '浏览菜单')}
              aria-expanded={browseOpen}
              aria-haspopup="true"
              aria-controls={BROWSE_PANEL_ID}
            >
              <Compass size={16} />
              浏览
              <ChevronDown size={15} className={`transition-transform duration-200 ${browseOpen ? 'rotate-180' : ''}`} />
            </button>

            {browseOpen ? (
              <div
                className="absolute left-1/2 top-full z-[70] -translate-x-1/2 pt-3"
                onMouseEnter={openBrowsePreview}
                onMouseLeave={() => {
                  if (!browsePinned) scheduleBrowseClose()
                }}
              >
                <BrowsePreview id={BROWSE_PANEL_ID} pathname={location.pathname} onNavigate={closeBrowse} />
              </div>
            ) : null}
          </div>

          <Link
            to="/search"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200"
            style={{
              color: location.pathname === '/search' ? 'var(--accent)' : 'var(--text-secondary)',
              backgroundColor: 'var(--bg-surface)',
            }}
            aria-label="搜索"
            title="搜索"
          >
            <Search size={18} />
          </Link>

          <button
            type="button"
            data-ui="command-palette-trigger"
            onClick={openCommandPalette}
            className="command-trigger"
            aria-label="打开智能命令搜索"
            title="智能搜索（Ctrl 或 Command + K）"
          >
            <Command size={16} aria-hidden="true" />
            <span>智能搜索</span>
            <kbd>⌘K</kbd>
          </button>

          <div
            ref={trackingPanelRef}
            className="relative"
            onMouseEnter={openTrackingPreview}
            onMouseLeave={() => {
              if (!trackingPinned) scheduleTrackingClose()
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) closeTracking()
            }}
          >
            <button
              ref={trackingTriggerRef}
              type="button"
              data-ui="desktop-tracking-trigger"
              onClick={handleTrackingButtonClick}
              onFocus={openTrackingPreview}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition-[background-color,color,transform] duration-200"
              style={{
                backgroundColor: trackingOpen ? 'var(--accent-soft)' : 'transparent',
                color: trackingOpen ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              aria-label={toggleLabel(trackingOpen, '追踪面板')}
              aria-expanded={trackingOpen}
              aria-haspopup="true"
              aria-controls={TRACKING_PANEL_ID}
            >
              <PanelsTopLeft size={16} />
              追踪
              <ChevronDown size={15} className={`transition-transform duration-200 ${trackingOpen ? 'rotate-180' : ''}`} />
            </button>

            {trackingOpen ? (
              <div
                className="absolute right-0 top-full z-[70] pt-3"
                onMouseEnter={openTrackingPreview}
                onMouseLeave={() => {
                  if (!trackingPinned) scheduleTrackingClose()
                }}
              >
                <TrackingPreview
                  id={TRACKING_PANEL_ID}
                  continueReading={continueReading}
                  followedTopics={followedTopics}
                  recentTopics={recentTopics}
                  onNavigate={closeTracking}
                />
              </div>
            ) : null}
          </div>

          <Link
            to={user ? '/account' : '/login'}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-3 transition-colors duration-200"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            aria-label={user ? '个人中心' : '登录'}
            title={user ? '个人中心' : '登录'}
          >
            <UserIcon size={18} />
            <span className="max-w-[8rem] truncate text-sm font-medium">
              {user ? (user.nickname || '个人中心') : '登录'}
            </span>
          </Link>

          <button
            onClick={toggleTheme}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors duration-200"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            aria-label="切换主题"
            aria-pressed={dark}
            title={dark ? '切换到浅色主题' : '切换到深色主题'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <button
            type="button"
            onClick={openCommandPalette}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            aria-label="打开智能命令搜索"
          >
            <Search size={18} aria-hidden="true" />
          </button>
          <button
            onClick={toggleTheme}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            aria-label="切换主题"
            aria-pressed={dark}
            title={dark ? '切换到浅色主题' : '切换到深色主题'}
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            ref={mobileMenuButtonRef}
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            aria-label="菜单"
            title={toggleLabel(mobileOpen, '导航菜单')}
            aria-expanded={mobileOpen}
            aria-haspopup="true"
            aria-controls={MOBILE_NAV_PANEL_ID}
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div id={MOBILE_NAV_PANEL_ID} ref={mobilePanelRef} className="max-h-[calc(100vh-4.5rem)] space-y-3 overflow-y-auto px-6 pb-5 lg:hidden" style={{ borderTop: '1px solid var(--border-muted)' }}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              active={location.pathname === item.to}
              onClick={() => setMobileOpen(false)}
            >
              <span className="block py-2">{item.label}</span>
            </NavLink>
          ))}

          <div data-ui="mobile-quick-links" className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false)
                openCommandPalette()
              }}
              className="flex items-center gap-2 rounded-lg border px-4 py-3 text-left text-sm font-semibold"
              style={{ borderColor: 'var(--accent-border)', color: 'var(--accent)', backgroundColor: 'var(--accent-soft)' }}
            >
              <Command size={16} aria-hidden="true" />
              智能搜索
            </button>
            <Link
              to="/search"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"
              style={{ borderColor: 'var(--border-muted)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            >
              <Search size={16} />
              搜索
            </Link>
            <Link
              to={user ? '/account' : '/login'}
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"
              style={{ borderColor: 'var(--border-muted)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface)' }}
            >
              <UserIcon size={16} />
              {user ? (user.nickname || '个人中心') : '登录'}
            </Link>
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}>
            <button
              type="button"
              data-ui="mobile-browse-trigger"
              onClick={() => {
                setMobileBrowseOpen((open) => !open)
                setMobileTrackingOpen(false)
              }}
              className="flex w-full items-center justify-between text-left"
              style={{ color: 'var(--text-primary)' }}
              aria-label={toggleLabel(mobileBrowseOpen, '浏览菜单')}
              aria-expanded={mobileBrowseOpen}
              aria-haspopup="true"
              aria-controls={MOBILE_BROWSE_PANEL_ID}
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <Compass size={16} />
                浏览
              </span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${mobileBrowseOpen ? 'rotate-180' : ''}`} />
            </button>

            {mobileBrowseOpen ? (
              <div id={MOBILE_BROWSE_PANEL_ID} data-ui="mobile-browse-links" className="mt-4 grid grid-cols-2 gap-1">
                {BROWSE_ITEMS.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-lg px-3 py-3 text-sm font-semibold transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
                    style={{ color: location.pathname === item.to ? 'var(--accent)' : 'var(--text-secondary)' }}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}>
            <button
              type="button"
              onClick={() => {
                setMobileTrackingOpen((open) => !open)
                setMobileBrowseOpen(false)
              }}
              data-ui="mobile-tracking-trigger"
              className="flex w-full items-center justify-between text-left"
              style={{ color: 'var(--text-primary)' }}
              aria-label={toggleLabel(mobileTrackingOpen, '追踪面板')}
              aria-expanded={mobileTrackingOpen}
              aria-haspopup="true"
              aria-controls={MOBILE_TRACKING_PANEL_ID}
            >
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                <PanelsTopLeft size={16} />
                追踪
              </span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${mobileTrackingOpen ? 'rotate-180' : ''}`} />
            </button>

            {mobileTrackingOpen ? (
              <div id={MOBILE_TRACKING_PANEL_ID} className="mt-4 space-y-4">
                <TrackingSection
                  icon={BookOpen}
                  title="继续阅读"
                  items={continueReading}
                  emptyText="读过的文章会出现在这里。"
                  renderItem={(item) => (
                    <TrackingCard
                      key={item.slug}
                      to={`/posts/${item.slug}`}
                      onNavigate={closeTracking}
                      title={item.title}
                      description={item.topic_display_title || item.topic_key || '最近阅读'}
                    />
                  )}
                />

                <TrackingSection
                  icon={Compass}
                  title="最近关注"
                  items={followedTopics}
                  emptyText="关注的主题会出现在这里。"
                  renderItem={(item) => (
                    <TrackingCard
                      key={item.topic_key}
                      to={`/topics/${item.topic_key}`}
                      onNavigate={closeTracking}
                      title={item.display_title || item.topic_key}
                      description="你已经关注的主题主线"
                    />
                  )}
                />

                <TrackingSection
                  icon={Clock3}
                  title="最近浏览"
                  items={recentTopics}
                  emptyText="最近浏览的主题会出现在这里。"
                  renderItem={(item) => (
                    <TrackingCard
                      key={item.topic_key}
                      to={`/topics/${item.topic_key}`}
                      onNavigate={closeTracking}
                      title={item.display_title || item.topic_key}
                      description={`最近活跃：${new Date(item.latest_post_at || Date.now()).toLocaleDateString('zh-CN')}`}
                    />
                  )}
                />

                <Link
                  to="/following"
                  onClick={closeTracking}
                  className="section-action"
                  style={{ color: hasTrackingData ? 'var(--accent)' : 'var(--text-secondary)' }}
                >
                  查看追踪页
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </nav>
  )
}
