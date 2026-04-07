import { useEffect, useState, useCallback } from 'react'
import { FileText, Eye, EyeOff, MessageSquare } from 'lucide-react'
import { fetchAdminStats } from '../../api/admin'

export default function AdminStats() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadStats = useCallback(async () => {
    setLoading(true)
    try { setStats(await fetchAdminStats()) } catch (err) { setError(err.message || '加载统计失败') }
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  return (
    <div>
      <h2 className="text-lg font-semibold mb-6 text-[var(--text-primary)]">数据统计</h2>
      {error && (
        <div className="mb-4 text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
      )}
      {loading ? (
        <div className="text-sm text-[var(--text-faint)]">加载中...</div>
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
              <div className="text-2xl font-bold mb-1 text-[var(--text-primary)]">{value}</div>
              <div className="text-xs text-[var(--text-faint)]">{label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[var(--text-faint)]">暂无统计数据</div>
      )}
    </div>
  )
}
