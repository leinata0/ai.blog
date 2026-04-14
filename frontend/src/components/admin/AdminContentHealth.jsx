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
      setError(err.message || 'Failed to load content health')
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
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Content Health</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            Track structural quality, source coverage, and publication hygiene.
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
        >
          <RefreshCcw size={14} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">
          Content health API unavailable: {error}
        </div>
      ) : null}

      {loading && !data ? <div className="text-sm text-[var(--text-faint)]">Loading...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Total Posts" value={overview.total_posts} />
        <MetricCard label="Published Posts" value={overview.published_posts} />
        <MetricCard label="Draft Posts" value={overview.draft_posts} />
        <MetricCard label="Avg Quality Score" value={overview.avg_quality_score} />
        <MetricCard label="Avg Source Count" value={overview.avg_source_count} />
        <MetricCard label="Avg Reading Time" value={overview.avg_reading_time} hint="minutes" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Priority Issues</h3>
          {issues.length ? (
            <div className="space-y-3">
              {issues.map((issue, index) => (
                <div key={`${issue.code || issue.title || 'issue'}-${index}`} className="rounded-lg bg-[var(--bg-canvas)] p-4">
                  <div className="mb-1 inline-flex items-center gap-2 text-sm font-medium text-amber-700">
                    <AlertTriangle size={14} />
                    {issue.title || issue.code || 'Issue'}
                  </div>
                  <div className="text-sm text-[var(--text-secondary)]">{issue.message || issue.detail || 'No details provided.'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={14} />
              No critical issues reported.
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Recommendations</h3>
          {recommendations.length ? (
            <div className="space-y-3">
              {recommendations.map((item, index) => (
                <div key={`${item.title || item}-${index}`} className="rounded-lg bg-[var(--bg-canvas)] p-4">
                  <div className="mb-1 text-sm font-medium text-[var(--text-primary)]">
                    {typeof item === 'string' ? item : item.title || 'Recommendation'}
                  </div>
                  {typeof item === 'object' && item.message ? (
                    <div className="text-sm text-[var(--text-secondary)]">{item.message}</div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[var(--text-faint)]">No recommendations yet.</div>
          )}
        </section>
      </div>
    </section>
  )
}
