import { useEffect, useState, useCallback, useRef } from 'react'
import { FileText, Eye, EyeOff, MessageSquare } from 'lucide-react'
import { fetchAdminStats } from '../../api/admin'

export default function AdminStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // AdminDashboardPage lazy-mounts one panel per section, so switching sections
  // unmounts this component while the request is still in flight. Every setState
  // after an await has to be gated on the component still being mounted.
  const activeRef = useRef(true)

  const loadStats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminStats()
      if (!activeRef.current) return
      setStats(result)
    } catch (err) {
      if (!activeRef.current) return
      setStats(null)
      setError(err.message || '加载统计失败')
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    loadStats()
    return () => {
      activeRef.current = false
    }
  }, [loadStats])

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">数据统计</h2>
      {error && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger-text)]">
          <span>{error}</span>
          <button
            type="button"
            onClick={loadStats}
            disabled={loading}
            className="min-h-11 rounded-lg border border-[var(--danger-text)] px-3 text-xs font-medium text-[var(--danger-text)] disabled:opacity-60"
          >
            重试
          </button>
        </div>
      )}
      {loading ? (
        <div role="status" className="text-sm text-[var(--text-faint)]">加载中…</div>
      ) : stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { label: '总文章数', value: stats.total_posts ?? '-', icon: FileText },
            { label: '草稿数', value: stats.draft_posts ?? '-', icon: EyeOff },
            { label: '总浏览量', value: stats.total_views ?? '-', icon: Eye },
            { label: '总评论数', value: stats.total_comments ?? '-', icon: MessageSquare },
            { label: '总点赞数', value: stats.total_likes ?? '-', icon: '❤️' },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl p-6 text-center bg-[var(--bg-surface)]" style={{ boxShadow: 'var(--card-shadow)' }}>
              <div className="mb-2">
                {typeof Icon === 'string' ? <span className="text-2xl">{Icon}</span> : <Icon size={24} className="text-[var(--accent)] mx-auto" />}
              </div>
              <div className="mb-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value}</div>
              <div className="text-xs text-[var(--text-faint)]">{label}</div>
            </div>
          ))}
        </div>
      ) : error ? null : (
        <div className="text-sm text-[var(--text-faint)]">暂无统计数据</div>
      )}
    </div>
  )
}
