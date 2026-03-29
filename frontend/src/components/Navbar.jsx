export default function Navbar() {
  return (
    <nav
      className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10"
      style={{
        height: '60px',
        borderBottom: '1px solid var(--border-muted)',
        backgroundColor: 'var(--bg-canvas)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <a href="/" className="font-terminal text-fluid-lg font-bold tracking-mono-normal" style={{ color: 'var(--text-primary)' }}>
        <span style={{ color: 'var(--accent)' }}>~/</span>极客开发日志
      </a>

      <div className="flex items-center gap-6 font-terminal text-fluid-sm" style={{ color: 'var(--text-secondary)' }}>
        <a href="/" className="hover:text-emerald-400 transition-colors">首页</a>
        <span style={{ color: 'var(--text-faint)' }}>dev.log v2026</span>
      </div>
    </nav>
  )
}
