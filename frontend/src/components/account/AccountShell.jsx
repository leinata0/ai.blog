import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpenText,
  CircleUserRound,
  Library,
  LogOut,
  Radar,
  ShieldCheck,
} from 'lucide-react'

import Navbar from '../Navbar'
import { proxyImageUrl } from '../../utils/proxyImage'

export const ACCOUNT_TABS = [
  { value: 'overview', label: '信号总览', icon: Radar, description: '回到最近阅读与关注主题' },
  { value: 'library', label: '我的资料库', icon: Library, description: '历史、点赞与评论' },
  { value: 'following', label: '关注主题', icon: BookOpenText, description: '管理持续追踪的信号' },
  { value: 'profile', label: '身份资料', icon: CircleUserRound, description: '头像、昵称与简介' },
  { value: 'security', label: '账号安全', icon: ShieldCheck, description: '密码、数据与设备' },
]

function initials(user) {
  const source = String(user?.nickname || user?.email || 'S').trim()
  return source.slice(0, 2).toUpperCase()
}

function PersonaAvatar({ user }) {
  // 第三方头像必须经过 proxyImageUrl（first-party 直连 R2/CDN，其余走后端 /proxy-image）。
  const avatarSrc = proxyImageUrl(user?.avatar_url)
  const [avatarBroken, setAvatarBroken] = useState(false)

  useEffect(() => {
    setAvatarBroken(false)
  }, [avatarSrc])

  const showImage = Boolean(avatarSrc) && !avatarBroken

  return (
    <div className="account-avatar" aria-hidden={showImage ? undefined : 'true'}>
      {showImage ? (
        <img
          src={avatarSrc}
          alt=""
          width="72"
          height="72"
          referrerPolicy="no-referrer"
          onError={() => setAvatarBroken(true)}
        />
      ) : (
        <span>{initials(user)}</span>
      )}
    </div>
  )
}

function SyncState({ state }) {
  const content = {
    syncing: ['正在同步', 'account-sync--active'],
    synced: ['云端已同步', 'account-sync--ready'],
    error: ['同步待重试', 'account-sync--error'],
    idle: ['跨设备账户', ''],
  }[state] || ['跨设备账户', '']
  return (
    <span className={`account-sync ${content[1]}`} role="status" aria-live="polite">
      <span aria-hidden="true" />
      {content[0]}
    </span>
  )
}

export default function AccountShell({
  user,
  activeTab,
  tabHref,
  counts,
  syncState,
  onLogout,
  children,
}) {
  return (
    <div data-ui="account-page" className="account-root min-h-screen">
      <Navbar />
      <main className="account-main">
        <header className="account-identity-strip">
          <div className="account-identity-strip__copy">
            <p className="account-kicker">Signal Desk / Personal Intelligence</p>
            <h1>{user?.nickname || '我的信号中心'}</h1>
            <p>把阅读轨迹、主题关注与账号状态整理成一张可继续行动的桌面。</p>
          </div>
          <div className="account-identity-strip__status">
            <SyncState state={syncState} />
            <span>{user?.email_verified ? '邮箱已验证' : '邮箱待验证'}</span>
          </div>
        </header>

        <div className="account-workspace">
          <aside className="account-sidebar" aria-label="个人信号中心导航">
            <div className="account-persona">
              <PersonaAvatar user={user} />
              <div className="min-w-0">
                <strong className="block truncate">{user?.nickname || 'Signal Reader'}</strong>
                <span className="block truncate">{user?.email}</span>
              </div>
            </div>

            <nav className="account-nav">
              {ACCOUNT_TABS.map(({ value, label, icon: Icon, description }) => (
                <Link
                  key={value}
                  to={tabHref(value)}
                  aria-current={activeTab === value ? 'page' : undefined}
                  className="account-nav__item"
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                  {value === 'library' && counts ? <em>{counts.history + counts.likes + counts.comments}</em> : null}
                </Link>
              ))}
            </nav>

            <button type="button" className="account-logout" onClick={onLogout}>
              <LogOut size={17} aria-hidden="true" />
              退出登录
            </button>
          </aside>

          <nav className="account-mobile-nav" aria-label="个人信号中心导航">
            {ACCOUNT_TABS.map(({ value, label, icon: Icon }) => (
              <Link
                key={value}
                to={tabHref(value)}
                aria-current={activeTab === value ? 'page' : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          <section className="account-content" aria-live="polite">
            {children}
          </section>
        </div>
      </main>
      <footer className="account-footer">
        <span>Signal Desk Identity</span>
        <Link to="/">返回公开站</Link>
        <Link to="/feeds">订阅中心</Link>
      </footer>
    </div>
  )
}
