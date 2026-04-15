import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Clock3,
  Compass,
  Menu,
  Moon,
  PanelsTopLeft,
  Sun,
  X,
} from 'lucide-react'

import { useTheme } from '../contexts/ThemeContext'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'

const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '主题', to: '/topics' },
  { label: '归档', to: '/archive' },
  { label: '标签', to: '/tags' },
  { label: '友链', to: '/friends' },
]

const TRACKING_CLOSE_DELAY_MS = 220

function NavLink({ to, active, children, onClick }) {
  const className = 'relative font-medium transition-colors duration-200 pb-1 group'
  const style = { color: active ? 'var(--accent)' : 'var(--text-secondary)' }

  return (
    <Link to={to} className={className} style={style} onClick={onClick}>
      {children}
      {active ? (
        <span className="absolute left-0 bottom-0 h-[2px] w-full" style={{ backgroundColor: 'var(--accent)' }} />
      ) : (
        <span
          className="absolute left-0 bottom-0 h-[2px] w-0 group-hover:w-full transition-all duration-300"
          style={{ backgroundColor: 'var(--accent)' }}
        />
      )}
    </Link>
  )
}

function TrackingSection({ icon: Icon, title, items, emptyText, renderItem }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--text-faint)' }}>
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

function TrackingPreview({
  continueReading,
  followedTopics,
  recentTopics,
  onNavigate,
  dark = false,
}) {
  return (
    <div
      data-ui="tracking-dropdown"
      className="w-[380px] rounded-[1.5rem] border p-4"
      style={{
        backgroundColor: dark ? 'rgba(22, 27, 34, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        borderColor: dark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.18)',
        boxShadow: '0 26px 70px rgba(15, 23, 42, 0.18)',
        backdropFilter: 'blur(16px)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            追踪
          </div>
          <p className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
            快速回到你刚才在看的文章和主题。
          </p>
        </div>
        <Link
          to="/following"
          onClick={onNavigate}
          className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}
        >
          查看追踪页
        </Link>
      </div>

      <div className="mt-4 space-y-4">
        <TrackingSection
          icon={BookOpen}
          title="继续阅读"
          items={continueReading}
          emptyText="读过的文章会出现在这里。"
          renderItem={(item) => (
            <Link
              key={item.slug}
              to={`/posts/${item.slug}`}
              onClick={onNavigate}
              className="block rounded-2xl border border-transparent px-3 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
            >
              <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {item.title}
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                {item.topic_display_title || item.topic_key || '最近阅读'}
              </div>
            </Link>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TrackingSection
            icon={Compass}
            title="最近关注"
            items={followedTopics}
            emptyText="关注的主题会出现在这里。"
            renderItem={(item) => (
              <Link
                key={item.topic_key}
                to={`/topics/${item.topic_key}`}
                onClick={onNavigate}
                className="block rounded-2xl border border-transparent px-3 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
              >
                <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {item.display_title || item.topic_key}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                  主题主线
                </div>
              </Link>
            )}
          />

          <TrackingSection
            icon={Clock3}
            title="最近浏览"
            items={recentTopics}
            emptyText="最近浏览的主题会出现在这里。"
            renderItem={(item) => (
              <Link
                key={item.topic_key}
                to={`/topics/${item.topic_key}`}
                onClick={onNavigate}
                className="block rounded-2xl border border-transparent px-3 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
              >
                <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {item.display_title || item.topic_key}
                </div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                  最近活跃：{new Date(item.latest_post_at || Date.now()).toLocaleDateString('zh-CN')}
                </div>
              </Link>
            )}
          />
        </div>
      </div>
    </div>
  )
}

export default function Navbar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileTrackingOpen, setMobileTrackingOpen] = useState(false)
  const [trackingOpen, setTrackingOpen] = useState(false)
  const [trackingPinned, setTrackingPinned] = useState(false)
  const [continueReading, setContinueReading] = useState([])
  const [followedTopics, setFollowedTopics] = useState([])
  const [recentTopics, setRecentTopics] = useState([])
  const panelRef = useRef(null)
  const closeTimerRef = useRef(null)
  const { dark, toggleTheme } = useTheme()

  useEffect(() => {
    setMobileOpen(false)
    setMobileTrackingOpen(false)
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
      if (!panelRef.current?.contains(event.target)) {
        setTrackingOpen(false)
        setTrackingPinned(false)
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setTrackingOpen(false)
        setTrackingPinned(false)
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
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  const hasTrackingData = useMemo(
    () => continueReading.length > 0 || followedTopics.length > 0 || recentTopics.length > 0,
    [continueReading.length, followedTopics.length, recentTopics.length],
  )

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  function scheduleClose() {
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      if (!trackingPinned) {
        setTrackingOpen(false)
      }
    }, TRACKING_CLOSE_DELAY_MS)
  }

  function openTrackingPreview() {
    clearCloseTimer()
    setTrackingOpen(true)
  }

  function closeTracking() {
    clearCloseTimer()
    setTrackingOpen(false)
    setTrackingPinned(false)
    setMobileOpen(false)
    setMobileTrackingOpen(false)
  }

  function handleTrackingButtonClick() {
    clearCloseTimer()
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
      className="sticky top-0 z-50 transition-all duration-300"
      style={{
        backgroundColor: dark ? 'rgba(22, 27, 34, 0.9)' : 'rgba(255, 255, 255, 0.87)',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
      }}
    >
      <div className="flex items-center justify-between px-6 sm:px-10 lg:px-20" style={{ height: '60px' }}>
        <Link to="/" className="text-xl font-semibold transition-colors duration-200" style={{ color: 'var(--accent)' }}>
          极客开发日志
        </Link>

        <div className="hidden md:flex items-center gap-8 text-[15px]">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} active={location.pathname === item.to}>
              {item.label}
            </NavLink>
          ))}

          <div
            ref={panelRef}
            className="relative"
            onMouseEnter={openTrackingPreview}
            onMouseLeave={() => {
              if (!trackingPinned) {
                scheduleClose()
              }
            }}
          >
            <button
              type="button"
              onClick={handleTrackingButtonClick}
              onFocus={openTrackingPreview}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-colors duration-200"
              style={{
                backgroundColor: trackingOpen ? 'rgba(37, 99, 235, 0.12)' : 'transparent',
                color: trackingOpen ? '#2563eb' : 'var(--text-secondary)',
              }}
              aria-label="打开追踪面板"
              aria-expanded={trackingOpen}
            >
              <PanelsTopLeft size={16} />
              追踪
              <ChevronDown size={15} className={`transition-transform duration-200 ${trackingOpen ? 'rotate-180' : ''}`} />
            </button>

            {trackingOpen ? (
              <div
                className="absolute right-0 top-full z-[70] pt-2"
                onMouseEnter={openTrackingPreview}
                onMouseLeave={() => {
                  if (!trackingPinned) {
                    scheduleClose()
                  }
                }}
              >
                <TrackingPreview
                  continueReading={continueReading}
                  followedTopics={followedTopics}
                  recentTopics={recentTopics}
                  onNavigate={closeTracking}
                  dark={dark}
                />
              </div>
            ) : null}
          </div>

          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors duration-200"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="切换主题"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        <div className="flex md:hidden items-center gap-2">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="切换主题"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={() => setMobileOpen((open) => !open)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="菜单"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {mobileOpen ? (
        <div
          className="space-y-3 px-6 pb-4 text-[15px] md:hidden"
          style={{ borderTop: '1px solid var(--border-muted)' }}
        >
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

          <div className="rounded-2xl border px-4 py-3" style={{ borderColor: 'var(--border-muted)' }}>
            <button
              type="button"
              onClick={() => setMobileTrackingOpen((open) => !open)}
              className="flex w-full items-center justify-between text-left"
              style={{ color: 'var(--text-primary)' }}
              aria-expanded={mobileTrackingOpen}
            >
              <span className="inline-flex items-center gap-2 font-medium">
                <PanelsTopLeft size={16} />
                追踪
              </span>
              <ChevronDown size={16} className={`transition-transform duration-200 ${mobileTrackingOpen ? 'rotate-180' : ''}`} />
            </button>

            {mobileTrackingOpen ? (
              <div className="mt-4 space-y-4">
                <TrackingSection
                  icon={BookOpen}
                  title="继续阅读"
                  items={continueReading}
                  emptyText="读过的文章会出现在这里。"
                  renderItem={(item) => (
                    <Link
                      key={item.slug}
                      to={`/posts/${item.slug}`}
                      onClick={closeTracking}
                      className="block rounded-2xl px-3 py-2"
                      style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {item.title}
                      </div>
                    </Link>
                  )}
                />

                <TrackingSection
                  icon={Compass}
                  title="最近关注"
                  items={followedTopics}
                  emptyText="关注的主题会出现在这里。"
                  renderItem={(item) => (
                    <Link
                      key={item.topic_key}
                      to={`/topics/${item.topic_key}`}
                      onClick={closeTracking}
                      className="block rounded-2xl px-3 py-2"
                      style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {item.display_title || item.topic_key}
                      </div>
                    </Link>
                  )}
                />

                <TrackingSection
                  icon={Clock3}
                  title="最近浏览"
                  items={recentTopics}
                  emptyText="最近浏览的主题会出现在这里。"
                  renderItem={(item) => (
                    <Link
                      key={item.topic_key}
                      to={`/topics/${item.topic_key}`}
                      onClick={closeTracking}
                      className="block rounded-2xl px-3 py-2"
                      style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                      <div className="line-clamp-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {item.display_title || item.topic_key}
                      </div>
                    </Link>
                  )}
                />

                <Link
                  to="/following"
                  onClick={closeTracking}
                  className="inline-flex items-center gap-2 text-sm font-medium"
                  style={{ color: hasTrackingData ? '#2563eb' : 'var(--text-secondary)' }}
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
