import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, Sun, Moon } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

const NAV_ITEMS = [
  { label: '首页', to: '/' },
  { label: '归档', to: '/archive' },
  { label: '标签', to: '/tags' },
  { label: '友链', to: '/friends' },
]

function NavLink({ to, active, children, onClick }) {
  const cls = 'relative font-medium transition-colors duration-200 pb-1 group'
  const style = { color: active ? 'var(--accent)' : 'var(--text-secondary)' }
  const underline = (
    <span
      className="absolute left-0 bottom-0 h-[2px] w-0 group-hover:w-full transition-all duration-300"
      style={{ backgroundColor: 'var(--accent)' }}
    />
  )
  return (
    <Link to={to} className={cls} style={style} onClick={onClick}>
      {children}
      {active && (
        <span className="absolute left-0 bottom-0 h-[2px] w-full" style={{ backgroundColor: 'var(--accent)' }} />
      )}
      {!active && underline}
    </Link>
  )
}

export default function Navbar() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { dark, toggleTheme } = useTheme()

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

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

        {/* 桌面导航 */}
        <div className="hidden md:flex items-center gap-8 text-[15px]">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} active={location.pathname === item.to}>
              {item.label}
            </NavLink>
          ))}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors duration-200"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="切换主题"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* 移动端控制 */}
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
            onClick={() => setMobileOpen(!mobileOpen)}
            className="p-2 rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="菜单"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* 移动端菜单 */}
      {mobileOpen && (
        <div
          className="md:hidden px-6 pb-4 space-y-3 text-[15px]"
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
        </div>
      )}
    </nav>
  )
}
