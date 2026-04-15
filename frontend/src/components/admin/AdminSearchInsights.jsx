import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCcw } from 'lucide-react'

import { fetchAdminSearchInsights } from '../../api/admin'

function normalizeInsightSections(payload = {}) {
  const topQueries = Array.isArray(payload?.top_queries)
    ? payload.top_queries
    : Array.isArray(payload?.items)
      ? payload.items.filter((item) => Number(item.result_count ?? 0) > 0)
      : []
  const zeroResultQueries = Array.isArray(payload?.zero_result_queries)
    ? payload.zero_result_queries
    : Array.isArray(payload?.items)
      ? payload.items.filter((item) => Number(item.result_count ?? 0) === 0)
      : []
  return {
    summary: payload?.summary || {},
    topQueries,
    zeroResultQueries,
  }
}

export default function AdminSearchInsights() {
  const [payload, setPayload] = useState({ summary: {}, topQueries: [], zeroResultQueries: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadInsights = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setPayload(normalizeInsightSections(await fetchAdminSearchInsights()))
    } catch (err) {
      setPayload({ summary: {}, topQueries: [], zeroResultQueries: [] })
      setError(err.message || '加载搜索洞察失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInsights()
  }, [loadInsights])

  const summaryCards = useMemo(() => ([
    { label: '搜索次数', value: payload.summary?.search_count ?? payload.topQueries.length + payload.zeroResultQueries.length },
    { label: '热门搜索词', value: payload.topQueries.length },
    { label: '零结果词', value: payload.zeroResultQueries.length },
  ]), [payload])

  return (
    <section data-ui="admin-search-insights">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">搜索洞察</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">观察读者都在搜什么，以及哪些关键词还没有得到内容覆盖。</p>
        </div>
        <button type="button" onClick={loadInsights} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]">
          <RefreshCcw size={14} />
          刷新
        </button>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((item) => (
          <div key={item.label} className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
            <div className="text-xs text-[var(--text-faint)]">{item.label}</div>
            <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">热门搜索词</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !payload.topQueries.length ? <div className="text-sm text-[var(--text-faint)]">暂时还没有热门搜索词。</div> : null}
          {payload.topQueries.length ? (
            <div className="space-y-3">
              {payload.topQueries.map((item, index) => (
                <div key={`${item.query}-${index}`} className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-4 py-3">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{item.query}</div>
                  <div className="mt-1 text-xs text-[var(--text-faint)]">
                    结果 {item.result_count ?? 0}{item.clicked_topic_key ? ` · 点击主题 ${item.clicked_topic_key}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">零结果搜索词</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !payload.zeroResultQueries.length ? <div className="text-sm text-[var(--text-faint)]">没有零结果搜索词，当前覆盖情况不错。</div> : null}
          {payload.zeroResultQueries.length ? (
            <div className="space-y-3">
              {payload.zeroResultQueries.map((item, index) => (
                <div key={`${item.query}-${index}`} className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-4 py-3">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{item.query}</div>
                  <div className="mt-1 text-xs text-[var(--text-faint)]">结果 {item.result_count ?? 0}</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  )
}
