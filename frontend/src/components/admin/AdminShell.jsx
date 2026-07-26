import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Command,
  ExternalLink,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  X,
} from 'lucide-react'

import { useTheme } from '../../contexts/ThemeContext'
import AdminJobsDock from './AdminJobsDock'
import AdminCommandPalette from './AdminCommandPalette'

const COLLAPSED_STORAGE_KEY = 'signal-desk-admin-sidebar-collapsed'

function readCollapsedPreference() {
  try {
    return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export default function AdminShell({
  groups,
  activeSection,
  onSectionChange,
  onCreatePost,
  onOpenPost,
  onReturnPublic,
  onLogout,
  title,
  description,
  children,
}) {
  const { dark, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(readCollapsedPreference)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [jobsOpenSignal, setJobsOpenSignal] = useState(0)
  const mobileTriggerRef = useRef(null)
  const mobileDialogRef = useRef(null)

  const closeCommand = useCallback(() => setCommandOpen(false), [])

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed))
    } catch {
      // The cockpit remains usable if storage is unavailable.
    }
  }, [collapsed])

  useEffect(() => {
    function handleShortcut(event) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setCommandOpen((current) => !current)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = mobileDialogRef.current
    const focusable = dialog
      ? Array.from(dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])'))
      : []
    focusable[0]?.focus()

    function handleMobileKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMobileOpen(false)
        return
      }
      if (event.key !== 'Tab' || !focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleMobileKeyDown)
    return () => {
      document.removeEventListener('keydown', handleMobileKeyDown)
      document.body.style.overflow = previousOverflow
      mobileTriggerRef.current?.focus()
    }
  }, [mobileOpen])

  function selectSection(section) {
    onSectionChange(section)
    setMobileOpen(false)
  }

  // Explicit "open" request instead of clicking the dock's toggle button through the
  // DOM: a synthetic click *closed* the dock whenever it was already open, so choosing
  // 「打开任务面板」 in the command palette did the opposite of what it says.
  const openJobs = useCallback(() => setJobsOpenSignal((current) => current + 1), [])

  const navigation = (
    <nav className="ops-nav" aria-label="管理分区">
      {groups.map((group) => (
        <section key={group.label} className="ops-nav__group">
          <h2>{group.label}</h2>
          <div>
            {group.items.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                aria-current={activeSection === key ? 'page' : undefined}
                aria-label={label}
                title={collapsed ? label : undefined}
                onClick={() => selectSection(key)}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {activeSection === key ? <i aria-hidden="true" /> : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </nav>
  )

  return (
    <main
      className={`ops-shell ${collapsed ? 'ops-shell--collapsed' : ''}`}
      data-ui="admin-cockpit"
    >
      <aside className="ops-sidebar" aria-label="Signal Desk 运营导航">
        <div className="ops-brand">
          <span className="ops-brand__mark" aria-hidden="true"><span /></span>
          <div>
            <strong>SIGNAL DESK</strong>
            <small>OPERATIONS / 2.1</small>
          </div>
        </div>
        {navigation}
        <div className="ops-sidebar__footer">
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? '展开侧栏' : '折叠侧栏'}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            <span>{collapsed ? '展开' : '折叠导航'}</span>
          </button>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="ops-mobile-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMobileOpen(false)
        }}>
          <aside
            ref={mobileDialogRef}
            className="ops-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="移动端管理导航"
          >
            <div className="ops-mobile-nav__header">
              <div className="ops-brand">
                <span className="ops-brand__mark" aria-hidden="true"><span /></span>
                <div><strong>SIGNAL DESK</strong><small>OPERATIONS</small></div>
              </div>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="关闭管理导航">
                <X size={19} />
              </button>
            </div>
            {navigation}
          </aside>
        </div>
      ) : null}

      <div className="ops-workspace">
        <header className="ops-topbar">
          <button
            ref={mobileTriggerRef}
            type="button"
            className="ops-topbar__menu"
            onClick={() => setMobileOpen(true)}
            aria-label="打开管理导航"
            aria-expanded={mobileOpen}
          >
            <Menu size={19} />
          </button>
          <div className="ops-topbar__signal">
            <span aria-hidden="true" />
            <p><strong>系统在线</strong><small>OPERATIONS CHANNEL</small></p>
          </div>
          <div className="ops-topbar__actions">
            <button
              type="button"
              className="ops-icon-action"
              onClick={() => setCommandOpen(true)}
              aria-label="打开管理命令面板"
              title="命令面板 (Ctrl/⌘ + K)"
            >
              <Command size={17} />
              <kbd>⌘K</kbd>
            </button>
            <AdminJobsDock openSignal={jobsOpenSignal} />
            <button
              type="button"
              className="ops-icon-action"
              onClick={toggleTheme}
              aria-label={dark ? '切换为浅色主题' : '切换为深色主题'}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              type="button"
              className="ops-icon-action"
              onClick={onReturnPublic}
              aria-label="返回公开站点"
              title="返回公开站点"
            >
              <ExternalLink size={17} />
            </button>
            <button
              type="button"
              className="ops-icon-action ops-icon-action--logout"
              onClick={onLogout}
              aria-label="退出管理端"
            >
              <LogOut size={17} />
              <span>退出</span>
            </button>
          </div>
        </header>

        <div className="ops-content">
          <header className="ops-page-heading">
            <div>
              <p className="ops-eyebrow">SIGNAL DESK / {activeSection.toUpperCase()}</p>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>
          </header>
          {children}
        </div>
      </div>

      <AdminCommandPalette
        open={commandOpen}
        onClose={closeCommand}
        groups={groups}
        activeSection={activeSection}
        onSelectSection={selectSection}
        onCreatePost={onCreatePost}
        onOpenPost={onOpenPost}
        onOpenJobs={openJobs}
      />
    </main>
  )
}
