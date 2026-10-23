import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BookOpen,
  ChevronDown,
  Clock3,
  Command,
  Compass,
  Menu,
  Moon,
  Search,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react'

import { useTheme } from '../contexts/ThemeContext'
import { useUser } from '../contexts/UserContext'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'
import { SITE_COPY } from '../utils/contentPresentation'
import { openCommandPalette } from '../utils/uiEvents'
import { formatDate } from '../utils/date'
import { getSurfaceForPath, SURFACES } from '../utils/surface'
import { useNewsStyle } from '../hooks/useNewsStyle'
import '../styles/news-immersive-nav.css'
import '../styles/tech-navigation.css'

const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '日报', to: '/daily' },
  { label: '周报', to: '/weekly' },
  { label: '主题', to: '/topics' },
  { label: '系列', to: '/series' },
  { label: '开始阅读', to: '/start-here' },
]

const BROWSE_ITEMS = [
  { label: '发现', to: '/discover' },
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
let publicShellMounts = 0

function toggleLabel(open, name) {
  return `${open ? '关闭' : '打开'}${name}`
}

function isNavActive(pathname, to) {
  return pathname === to || (to !== '/' && pathname.startsWith(`${to}/`))
}

function NavLink({ to, active, children, onClick }) {
  return (
    <Link to={to} className={`news-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
      {children}
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
      className="news-tracking-card"
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
    <div id={id} data-ui="browse-dropdown" className="news-popover news-browse-popover">
      <div className="grid grid-cols-2 gap-1">
        {BROWSE_ITEMS.map((item) => {
          const active = pathname === item.to || pathname.startsWith(`${item.to}/`)
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className="news-browse-link"
              style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
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
    <div id={id} data-ui="tracking-dropdown" className="news-popover news-tracking-popover">
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
                description={formatDate(item.latest_post_at) ? `最近更新：${formatDate(item.latest_post_at)}` : '最近浏览的主题'}
              />
            )}
          />
        </div>
      </div>
    </div>
  )
}

export default function Navbar({ immersive = false }) {
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
  const { newsStyle, setNewsStyle } = useNewsStyle()
  const isEditorialSurface = getSurfaceForPath(location.pathname) === SURFACES.EDITORIAL
  const isImmersive = immersive && isEditorialSurface && newsStyle === 'tech'

  useEffect(() => {
    if (!isEditorialSurface) return undefined
    publicShellMounts += 1
    document.body.classList.add('public-news-shell')
    return () => {
      publicShellMounts -= 1
      if (publicShellMounts === 0) document.body.classList.remove('public-news-shell')
    }
  }, [isEditorialSurface])

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

  const secondaryNavigation = (
    <div className="news-secondary-navigation">
      <div ref={browsePanelRef} className="news-disclosure" onMouseEnter={openBrowsePreview} onMouseLeave={() => { if (!browsePinned) scheduleBrowseClose() }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeBrowse() }}>
        <button ref={browseTriggerRef} type="button" data-ui="desktop-browse-trigger" onClick={handleBrowseButtonClick} onFocus={openBrowsePreview} className="news-nav-button" aria-label={toggleLabel(browseOpen, '浏览菜单')} aria-expanded={browseOpen} aria-haspopup="true" aria-controls={BROWSE_PANEL_ID}>
          更多栏目 <ChevronDown size={13} aria-hidden="true" className={browseOpen ? 'is-open' : ''} />
        </button>
        {browseOpen ? (
          <div className="news-popover-anchor" onMouseEnter={openBrowsePreview} onMouseLeave={() => { if (!browsePinned) scheduleBrowseClose() }}>
            <BrowsePreview id={BROWSE_PANEL_ID} pathname={location.pathname} onNavigate={closeBrowse} />
          </div>
        ) : null}
      </div>
      <div ref={trackingPanelRef} className="news-disclosure" onMouseEnter={openTrackingPreview} onMouseLeave={() => { if (!trackingPinned) scheduleTrackingClose() }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeTracking() }}>
        <button ref={trackingTriggerRef} type="button" data-ui="desktop-tracking-trigger" onClick={handleTrackingButtonClick} onFocus={openTrackingPreview} className="news-nav-button" aria-label={toggleLabel(trackingOpen, '追踪面板')} aria-expanded={trackingOpen} aria-haspopup="true" aria-controls={TRACKING_PANEL_ID}>
          <BookOpen size={14} aria-hidden="true" /> 我的阅读 <ChevronDown size={13} aria-hidden="true" className={trackingOpen ? 'is-open' : ''} />
        </button>
        {trackingOpen ? (
          <div className="news-popover-anchor news-popover-anchor--right" onMouseEnter={openTrackingPreview} onMouseLeave={() => { if (!trackingPinned) scheduleTrackingClose() }}>
            <TrackingPreview id={TRACKING_PANEL_ID} continueReading={continueReading} followedTopics={followedTopics} recentTopics={recentTopics} onNavigate={closeTracking} />
          </div>
        ) : null}
      </div>
    </div>
  )

  const menuPanel = mobileOpen ? (
    <div id={MOBILE_NAV_PANEL_ID} ref={mobilePanelRef} className={`news-mobile-panel${isImmersive ? ' news-edition-menu' : ''}`}>
      <nav aria-label={isImmersive ? '主导航' : '菜单导航'} className="news-mobile-primary">
        {NAV_ITEMS.map((item) => <NavLink key={item.to} to={item.to} active={isNavActive(location.pathname, item.to)} onClick={() => setMobileOpen(false)}>{item.label}</NavLink>)}
      </nav>
      <div data-ui="mobile-quick-links" className="news-mobile-quick-links">
        <Link to="/search" onClick={() => setMobileOpen(false)}><Search size={15} aria-hidden="true" /> 搜索</Link>
        <Link to={user ? '/account' : '/login'} onClick={() => setMobileOpen(false)}><UserIcon size={15} aria-hidden="true" />{user ? (user.nickname || '个人中心') : '登录'}</Link>
        <Link to="/feeds" onClick={() => setMobileOpen(false)}>订阅中心 ↗</Link>
      </div>
      {isImmersive ? <section className="news-edition-menu__preferences" aria-label="阅读设置">
        <div className="news-style-switch" role="group" aria-label="新闻页面风格">
          <button type="button" aria-pressed={newsStyle === 'tech'} onClick={() => setNewsStyle('tech')}>科技版</button>
          <button type="button" aria-pressed={newsStyle === 'paper'} onClick={() => { setMobileOpen(false); setNewsStyle('paper') }}>报刊版</button>
        </div>
        <button type="button" className="news-edition-menu__command" onClick={() => { setMobileOpen(false); openCommandPalette() }} aria-label="打开智能命令搜索"><Command size={14} aria-hidden="true" /> 智能命令搜索 <kbd>⌘K</kbd></button>
      </section> : null}
      <section className="news-mobile-section">
        <button type="button" data-ui="mobile-browse-trigger" onClick={() => { setMobileBrowseOpen((open) => !open); setMobileTrackingOpen(false) }} className="news-mobile-disclosure" aria-label={toggleLabel(mobileBrowseOpen, '浏览菜单')} aria-expanded={mobileBrowseOpen} aria-haspopup="true" aria-controls={MOBILE_BROWSE_PANEL_ID}>
          更多栏目 <ChevronDown size={16} aria-hidden="true" />
        </button>
        {mobileBrowseOpen ? <div id={MOBILE_BROWSE_PANEL_ID} data-ui="mobile-browse-links" className="news-mobile-link-grid">
          {BROWSE_ITEMS.map((item) => <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}>{item.label}</Link>)}
        </div> : null}
      </section>
      <section className="news-mobile-section">
        <button type="button" data-ui="mobile-tracking-trigger" onClick={() => { setMobileTrackingOpen((open) => !open); setMobileBrowseOpen(false) }} className="news-mobile-disclosure" aria-label={toggleLabel(mobileTrackingOpen, '追踪面板')} aria-expanded={mobileTrackingOpen} aria-haspopup="true" aria-controls={MOBILE_TRACKING_PANEL_ID}>
          我的阅读 <ChevronDown size={16} aria-hidden="true" />
        </button>
        {mobileTrackingOpen ? <div id={MOBILE_TRACKING_PANEL_ID} className="news-mobile-tracking">
          <TrackingSection icon={BookOpen} title="继续阅读" items={continueReading} emptyText="读过的文章会出现在这里。" renderItem={(item) => <TrackingCard key={item.slug} to={`/posts/${item.slug}`} onNavigate={closeTracking} title={item.title} description={item.topic_display_title || item.topic_key || '最近阅读'} />} />
          <TrackingSection icon={Compass} title="最近关注" items={followedTopics} emptyText="关注的主题会出现在这里。" renderItem={(item) => <TrackingCard key={item.topic_key} to={`/topics/${item.topic_key}`} onNavigate={closeTracking} title={item.display_title || item.topic_key} description="你已关注的主题" />} />
          <TrackingSection icon={Clock3} title="最近浏览" items={recentTopics} emptyText="最近浏览的主题会出现在这里。" renderItem={(item) => <TrackingCard key={item.topic_key} to={`/topics/${item.topic_key}`} onNavigate={closeTracking} title={item.display_title || item.topic_key} description={formatDate(item.latest_post_at) ? `最近更新：${formatDate(item.latest_post_at)}` : '最近浏览的主题'} />} />
          <Link to="/following" onClick={closeTracking} className="news-tracking-all">查看追踪页 <span aria-hidden="true">↗</span></Link>
        </div> : null}
      </section>
    </div>
  ) : null

  if (isImmersive) return (
    <header ref={navRef} className="news-navbar news-navbar--immersive news-edition-header" data-surface="editorial" data-ui="news-header">
      <div className="news-edition-header__bar">
        <Link to="/" className="news-edition-header__brand" aria-label={`${SITE_COPY.brand}首页`}>{SITE_COPY.brand}</Link>
        <div className="news-edition-header__actions">
          <button ref={mobileMenuButtonRef} type="button" className="news-edition-header__action" onClick={() => setMobileOpen((open) => !open)} aria-label="菜单" title={toggleLabel(mobileOpen, '导航菜单')} aria-expanded={mobileOpen} aria-haspopup="true" aria-controls={MOBILE_NAV_PANEL_ID}>
            {mobileOpen ? <X size={15} aria-hidden="true" /> : <Menu size={15} aria-hidden="true" />}<span>菜单</span>
          </button>
          <Link to="/search" className="news-edition-header__action" aria-label="搜索"><Search size={14} aria-hidden="true" /><span>搜索</span></Link>
          <Link to="/feeds" className="news-edition-header__action">订阅 <span aria-hidden="true">↗</span></Link>
        </div>
      </div>
      {menuPanel}
    </header>
  )

  if (isEditorialSurface && newsStyle === 'tech') return (
    <header ref={navRef} className="news-navbar tech-navigation" data-surface="editorial" data-ui="news-header">
      <div className="tech-navigation__bar">
        <Link to="/" className="tech-navigation__brand" aria-label={`${SITE_COPY.brand}首页`}>
          <span className="tech-navigation__mark" aria-hidden="true"><i /><i /><i /></span>
          <span>AI <b>OBSERVER</b></span>
        </Link>
        <nav className="tech-navigation__primary" aria-label="主导航">
          {NAV_ITEMS.map((item, index) => <Link key={item.to} to={item.to} className={`tech-navigation__link${isNavActive(location.pathname, item.to) ? ' is-active' : ''}`} aria-current={isNavActive(location.pathname, item.to) ? 'page' : undefined}><small aria-hidden="true">{String(index).padStart(2, '0')}</small>{item.label}</Link>)}
        </nav>
        <div className="tech-navigation__actions">
          <div className="news-style-switch" role="group" aria-label="新闻页面风格">
            <button type="button" aria-pressed="true" onClick={() => setNewsStyle('tech')}>科技版</button>
            <button type="button" aria-pressed="false" onClick={() => setNewsStyle('paper')}>报刊版</button>
          </div>
          <Link to="/search" className="tech-navigation__search" aria-label="搜索"><Search size={16} aria-hidden="true" /><span>搜索</span></Link>
          <button type="button" className="tech-navigation__command" data-ui="command-palette-trigger" onClick={openCommandPalette} aria-label="打开智能命令搜索"><Command size={15} aria-hidden="true" /></button>
          <Link to={user ? '/account' : '/login'} className="tech-navigation__account" aria-label={user ? '个人中心' : '登录'}><UserIcon size={16} aria-hidden="true" /></Link>
          <button ref={mobileMenuButtonRef} type="button" className="tech-navigation__menu" onClick={() => setMobileOpen((open) => !open)} aria-label="菜单" title={toggleLabel(mobileOpen, '导航菜单')} aria-expanded={mobileOpen} aria-haspopup="true" aria-controls={MOBILE_NAV_PANEL_ID}>{mobileOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>
        </div>
      </div>
      <div className="tech-navigation__context"><span className="tech-navigation__location">AI OBSERVER / <b>{NAV_ITEMS.find((item) => isNavActive(location.pathname, item.to))?.label || '阅读档案'}</b></span><div className="tech-navigation__utilities">{secondaryNavigation}<Link to="/feeds" className="tech-navigation__subscribe">订阅更新 <span aria-hidden="true">↗</span></Link></div></div>
      {menuPanel}
    </header>
  )

  return (
    <header ref={navRef} className={`news-navbar${isImmersive ? ' news-navbar--immersive' : ''}`} data-surface="editorial" data-ui="news-header">
      <div className="news-shell-container">
        <div className="news-utility-strip">
          <p>中文 AI 新闻与观察</p>
          <div className="news-utility-actions">
            {isEditorialSurface ? (
              <div className="news-style-switch" role="group" aria-label="新闻页面风格">
                <button type="button" aria-pressed={newsStyle === 'tech'} onClick={() => setNewsStyle('tech')}>科技版</button>
                <button type="button" aria-pressed={newsStyle === 'paper'} onClick={() => setNewsStyle('paper')}>报刊版</button>
              </div>
            ) : null}
            <Link to="/search" className="news-tool news-desktop-tool" aria-label="搜索" title="搜索新闻">
              <Search size={15} aria-hidden="true" /><span>搜索</span>
            </Link>
            <button type="button" className="news-tool news-command-tool" data-ui="command-palette-trigger" onClick={openCommandPalette} aria-label="打开智能命令搜索" title="智能搜索（Ctrl 或 Command + K）">
              <Command size={14} aria-hidden="true" /><kbd>⌘K</kbd>
            </button>
            <Link to={user ? '/account' : '/login'} className="news-tool news-account-tool" aria-label={user ? '个人中心' : '登录'}>
              <UserIcon size={14} aria-hidden="true" /><span>{user ? (user.nickname || '个人中心') : '登录'}</span>
            </Link>
            {!isEditorialSurface || newsStyle === 'paper' ? <button type="button" onClick={toggleTheme} className="news-tool" aria-label="切换主题" aria-pressed={dark} title={dark ? '切换到浅色主题' : '切换到深色主题'}>
              {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button> : null}
            <button ref={mobileMenuButtonRef} type="button" onClick={() => setMobileOpen((open) => !open)} className="news-tool news-mobile-menu-button" aria-label="菜单" title={toggleLabel(mobileOpen, '导航菜单')} aria-expanded={mobileOpen} aria-haspopup="true" aria-controls={MOBILE_NAV_PANEL_ID}>
              {mobileOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="news-masthead">
          <p className="news-masthead-note">模型 · 产品 · 研究<br /><span>把变化放回上下文</span></p>
          <Link to="/" className="news-brand" aria-label={`${SITE_COPY.brand}首页`}>
            <span className="news-brand-symbol" aria-hidden="true"><i /><i /></span>
            <span className="news-brand-title">{SITE_COPY.brand}</span>
            <span className="news-brand-english" translate="no">AI OBSERVER</span>
          </Link>
          <div className="news-masthead-subscribe">
            <Link to="/feeds" className="news-subscribe-link">订阅更新 <span aria-hidden="true">↗</span></Link>
            <span>按你的节奏，阅读 AI</span>
          </div>
        </div>

        <nav aria-label="主导航" className="news-navigation">
          <div className="news-primary-links">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} active={isNavActive(location.pathname, item.to)}>{item.label}</NavLink>
            ))}
          </div>
          {secondaryNavigation}
        </nav>

        {menuPanel}
      </div>
    </header>
  )
}
