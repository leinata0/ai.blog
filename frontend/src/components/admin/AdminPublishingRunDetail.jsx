import { useCallback, useEffect, useState } from 'react'
import { RefreshCcw, X } from 'lucide-react'

import { fetchAdminPublishingRunDetail } from '../../api/admin'

function SnapshotSection({ title, items, emptyText }) {
  return (
    <section className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
      <h4 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
      {Array.isArray(items) && items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={`${item.topic_key || item.title || 'item'}-${index}`} className="rounded-md bg-[var(--bg-surface)] p-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">{item.title || item.topic_key || '未命名主题'}</div>
              <div className="mt-1 text-xs text-[var(--text-faint)]">
                {item.topic_key ? `topic_key：${item.topic_key}` : null}
                {item.post_slug ? `  slug：${item.post_slug}` : null}
              </div>
              {item.reason ? <div className="mt-2 text-xs text-amber-700">{item.reason}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[var(--text-faint)]">{emptyText}</div>
      )}
    </section>
  )
}

export default function AdminPublishingRunDetail({ runId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadDetail = useCallback(async () => {
    if (!runId) return
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminPublishingRunDetail(runId)
      setData(result)
    } catch (err) {
      setData(null)
      setError(err.message || '加载运行详情失败')
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  if (!runId) return null

  const summary = data?.summary || {}

  return (
    <section data-ui="admin-publishing-run-detail" className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">运行详情</h3>
          <div className="mt-1 text-xs text-[var(--text-faint)]">运行 ID：{runId}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadDetail}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            <RefreshCcw size={12} />
            刷新
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            <X size={12} />
            关闭
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}
      {loading && !data ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}

      {data ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg bg-[var(--bg-canvas)] p-3 text-center">
              <div className="text-xs text-[var(--text-faint)]">候选主题</div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{summary.candidate_count ?? 0}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-canvas)] p-3 text-center">
              <div className="text-xs text-[var(--text-faint)]">成功发布</div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{summary.published_count ?? 0}</div>
            </div>
            <div className="rounded-lg bg-[var(--bg-canvas)] p-3 text-center">
              <div className="text-xs text-[var(--text-faint)]">跳过主题</div>
              <div className="text-xl font-semibold text-[var(--text-primary)]">{summary.skipped_count ?? 0}</div>
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <SnapshotSection title="候选主题" items={data.candidate_topics} emptyText="没有候选主题。" />
            <SnapshotSection title="已发布主题" items={data.published_topics} emptyText="没有已发布主题。" />
            <SnapshotSection title="已跳过主题" items={data.skipped_topics} emptyText="没有已跳过主题。" />
          </div>
        </div>
      ) : null}
    </section>
  )
}
