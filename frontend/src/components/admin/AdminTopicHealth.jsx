import { useCallback, useEffect, useState } from 'react'
import { RefreshCcw } from 'lucide-react'

import { fetchAdminTopicHealth } from '../../api/admin'

export default function AdminTopicHealth() {
  const [payload, setPayload] = useState({ summary: {}, items: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadTopicHealth = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const next = await fetchAdminTopicHealth()
      setPayload({
        summary: next?.summary || {},
        items: Array.isArray(next?.items) ? next.items : [],
      })
    } catch (err) {
      setPayload({ summary: {}, items: [] })
      setError(err.message || '加载主题健康失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTopicHealth()
  }, [loadTopicHealth])

  const summaryCards = [
    { label: '主题数', value: payload.summary?.topic_count ?? payload.items.length ?? 0 },
    { label: '活跃主题', value: payload.summary?.active_topic_count ?? 0 },
    { label: '推荐主题', value: payload.summary?.featured_topic_count ?? 0 },
    { label: '平均质量分', value: payload.summary?.avg_quality_score ?? '-' },
  ]

  return (
    <section data-ui="admin-topic-health">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">主题健康</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">查看每条主题主线的文章数量、质量分、来源数和最近活跃时间。</p>
        </div>
        <button type="button" onClick={loadTopicHealth} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]">
          <RefreshCcw size={14} />
          刷新
        </button>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        {summaryCards.map((item) => (
          <div key={item.label} className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
            <div className="text-xs text-[var(--text-faint)]">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
        {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
        {!loading && !payload.items.length ? <div className="text-sm text-[var(--text-faint)]">暂时还没有主题健康数据。</div> : null}
        {payload.items.length ? (
          <div className="space-y-3">
            {payload.items.map((item) => (
              <div key={item.topic_key} className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)]">{item.display_title || item.topic_key}</div>
                    <div className="mt-1 text-xs text-[var(--text-faint)]">topic_key：{item.topic_key}</div>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-[var(--text-faint)]">
                    <span>{item.post_count ?? 0} 篇文章</span>
                    <span>均分 {item.avg_quality_score ?? '-'}</span>
                    <span>来源 {item.source_count ?? 0}</span>
                    {item.latest_post_at ? <span>最近更新 {new Date(item.latest_post_at).toLocaleDateString('zh-CN')}</span> : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
