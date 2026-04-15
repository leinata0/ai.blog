import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCcw } from 'lucide-react'

import { fetchAdminContentHealth } from '../../api/admin'

function MetricCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value ?? '-'}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--text-faint)]">{hint}</div> : null}
    </div>
  )
}

export default function AdminContentHealth() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminContentHealth()
      setData(result)
    } catch (err) {
      setData(null)
      setError(err.message || '加载内容健康面板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const overview = data?.overview || data || {}
  const issues = Array.isArray(data?.issues) ? data.issues : []
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : []

  return (
    <section data-ui="admin-content-health">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">内容健康</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            追踪结构完整度、来源覆盖情况，以及发布层面的健康度。
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
        >
          <RefreshCcw size={14} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">
          内容健康接口暂不可用：{error}
        </div>
      ) : null}

      {loading && !data ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="文章总数" value={overview.total_posts} />
        <MetricCard label="已发布文章" value={overview.published_posts} />
        <MetricCard label="草稿文章" value={overview.draft_posts} />
        <MetricCard label="平均质量分" value={overview.avg_quality_score} />
        <MetricCard label="平均来源数" value={overview.avg_source_count} />
        <MetricCard label="平均阅读时长" value={overview.avg_reading_time} hint="分钟" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">优先问题</h3>
          {issues.length ? (
            <div className="space-y-3">
              {issues.map((issue, index) => (
                <div key={`${issue.code || issue.title || 'issue'}-${index}`} className="rounded-lg bg-[var(--bg-canvas)] p-4">
                  <div className="mb-1 inline-flex items-center gap-2 text-sm font-medium text-amber-700">
                    <AlertTriangle size={14} />
                    {issue.title || issue.code || '问题'}
                  </div>
                  <div className="text-sm text-[var(--text-secondary)]">{issue.message || issue.detail || '暂无详细说明。'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={14} />
              当前没有高优先级问题。
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">优化建议</h3>
          {recommendations.length ? (
            <div className="space-y-3">
              {recommendations.map((item, index) => (
                <div key={`${item.title || item}-${index}`} className="rounded-lg bg-[var(--bg-canvas)] p-4">
                  <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">
                    {typeof item === 'string' ? item : item.title || '建议'}
                  </div>
                  {typeof item === 'object' && item.message ? (
                    <div className="text-sm text-[var(--text-secondary)]">{item.message}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-faint)]">暂时没有新增建议。</div>
          )}
        </section>
      </div>
    </section>
  )
}
