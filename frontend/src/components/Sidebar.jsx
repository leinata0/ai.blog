export default function Sidebar() {
  return (
    <aside className="space-y-6">
      {/* Author Card */}
      <div
        className="rounded-lg p-6 text-center"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-muted)' }}
      >
        <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
          <span className="text-4xl">👨‍💻</span>
        </div>
        <h3 className="font-bold text-fluid-lg mb-2" style={{ color: 'var(--text-primary)' }}>极客新生</h3>
        <p className="text-fluid-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>大一 CS 学生 / Python & C++ 爱好者</p>

        <div className="flex justify-around mb-4 py-3" style={{ borderTop: '1px solid var(--border-muted)', borderBottom: '1px solid var(--border-muted)' }}>
          <div>
            <div className="font-bold text-fluid-lg" style={{ color: 'var(--accent)' }}>4</div>
            <div className="text-fluid-xs" style={{ color: 'var(--text-faint)' }}>文章</div>
          </div>
          <div>
            <div className="font-bold text-fluid-lg" style={{ color: 'var(--accent)' }}>6</div>
            <div className="text-fluid-xs" style={{ color: 'var(--text-faint)' }}>标签</div>
          </div>
        </div>

        <a
          href="https://github.com"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full py-2 rounded font-terminal text-fluid-sm font-medium transition-all hover:brightness-110"
          style={{ backgroundColor: 'var(--accent)', color: '#0a0a0a' }}
        >
          GitHub
        </a>
      </div>

      {/* Announcement */}
      <div
        className="rounded-lg p-5"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-muted)' }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">📢</span>
          <h4 className="font-terminal font-semibold text-fluid-sm" style={{ color: 'var(--accent)' }}>公告</h4>
        </div>
        <p className="text-fluid-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          持续更新 Python、C/C++ 与开源项目实践笔记
        </p>
      </div>
    </aside>
  )
}
