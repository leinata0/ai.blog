export default function Navbar() {
  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10"
      style={{
        height: '60px',
        borderBottom: '1px solid var(--border-muted)',
        backgroundColor: 'rgba(248, 250, 252, 0.8)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <a href="/" className="text-fluid-lg font-bold" style={{ color: 'var(--text-primary)' }}>
        极客开发日志
      </a>

      <div className="flex items-center gap-6 text-fluid-sm" style={{ color: 'var(--text-secondary)' }}>
        <a href="/" className="transition-colors" style={{ color: 'var(--text-secondary)' }} onMouseEnter={(e) => e.target.style.color = 'var(--accent)'} onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}>首页</a>
        <span style={{ color: 'var(--text-faint)' }}>v2026</span>
      </div>
    </nav>
  )
}
