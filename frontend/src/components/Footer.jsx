import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer
      className="border-t px-6 sm:px-10 lg:px-20 py-8"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-sm" style={{ color: 'var(--text-faint)' }}>
          <Link to="/" className="transition-colors duration-200 hover:text-[var(--accent)]">首页</Link>
          <Link to="/feeds" className="transition-colors duration-200 hover:text-[var(--accent)]">订阅</Link>
          <Link to="/archive" className="transition-colors duration-200 hover:text-[var(--accent)]">归档</Link>
          <Link to="/tags" className="transition-colors duration-200 hover:text-[var(--accent)]">标签</Link>
          <a href="/feed.xml" className="transition-colors duration-200 hover:text-[var(--accent)]">RSS</a>
        </div>
        <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-faint)' }}>
          <span>&copy; {new Date().getFullYear()} AI 资讯观察</span>
          <span>&middot;</span>
          <span>持续更新的 AI 资讯与观察</span>
          <span>&middot;</span>
          <Link to="/admin/login" className="transition-colors duration-200 hover:text-[var(--accent)] opacity-40 hover:opacity-70">管理</Link>
        </div>
      </div>
    </footer>
  )
}
