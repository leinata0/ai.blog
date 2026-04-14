import { useCallback, useEffect, useState } from 'react'
import { Activity, Clock3, PlayCircle, SkipForward } from 'lucide-react'

import { fetchAdminPublishingStatus } from '../../api/admin'
import { formatDate } from '../../utils/date'
import AdminPublishingRunDetail from './AdminPublishingRunDetail'

function StatusPill({ status }) {
  const normalized = String(status || 'unknown').toLowerCase()
  const palette =
    normalized === 'success'
      ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
      : normalized === 'running'
        ? 'bg-sky-100 text-sky-700'
        : normalized === 'failed'
          ? 'bg-[var(--danger-soft)] text-[#ef4444]'
          : 'bg-[var(--bg-canvas)] text-[var(--text-secondary)]'

  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${palette}`}>
      {status || 'unknown'}
    </span>
  )
}

function RunCard({ title, run }) {
  if (!run) {
    return (
      <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
        <div className="mb-2 text-sm font-medium text-[var(--text-secondary)]">{title}</div>
        <div className="text-sm text-[var(--text-faint)]">No run snapshot yet.</div>
      </section>
    )
  }

  const stats = [
    { label: 'Candidates', value: run.summary?.candidate_count ?? 0, icon: Activity },
    { label: 'Published', value: run.summary?.published_count ?? 0, icon: PlayCircle },
    { label: 'Skipped', value: run.summary?.skipped_count ?? 0, icon: SkipForward },
  ]

  return (
    <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 text-sm font-medium text-[var(--text-secondary)]">{title}</div>
          <div className="text-lg font-semibold text-[var(--text-primary)]">{run.coverage_date || 'No coverage date'}</div>
          <div className="mt-1 text-xs text-[var(--text-faint)]">
            {(run.run_mode || 'auto') === 'manual' ? 'Manual run' : 'Auto run'} • Updated {formatDate(run.updated_at)}
          </div>
        </div>
        <StatusPill status={run.status} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-lg bg-[var(--bg-canvas)] p-3 text-center">
            <Icon size={16} className="mx-auto mb-2 text-[var(--accent)]" />
            <div className="text-lg font-semibold text-[var(--text-primary)]">{value}</div>
            <div className="text-xs text-[var(--text-faint)]">{label}</div>
          </div>
        ))}
      </div>
      {run.message ? (
        <div className="mt-4 rounded-lg bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          {run.message}
        </div>
      ) : null}
    </section>
  )
}

function TopicList({ title, items, emptyText }) {
  return (
    <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
      <div className="mb-4 text-sm font-semibold text-[var(--text-primary)]">{title}</div>
      {items?.length ? (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={`${item.topic_key || item.post_slug || item.title}-${index}`}
              className="rounded-lg bg-[var(--bg-canvas)] p-4"
            >
              <div className="mb-1 flex items-start justify-between gap-3">
                <div className="font-medium text-[var(--text-primary)]">{item.title}</div>
                <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
                  {item.content_type || 'daily_brief'}
                </span>
              </div>
              {item.summary ? <div className="mb-2 text-sm text-[var(--text-secondary)]">{item.summary}</div> : null}
              <div className="flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                <span>topic_key: {item.topic_key || 'n/a'}</span>
                <span>source_count: {item.source_count ?? 0}</span>
                {item.published_mode ? <span>mode: {item.published_mode}</span> : null}
                {item.post_slug ? <span>slug: {item.post_slug}</span> : null}
              </div>
              {item.source_names?.length ? (
                <div className="mt-2 text-xs text-[var(--text-faint)]">sources: {item.source_names.join(' / ')}</div>
              ) : null}
              {item.reason ? <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{item.reason}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[var(--text-faint)]">{emptyText}</div>
      )}
    </section>
  )
}

function RecentPosts({ posts }) {
  return (
    <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
      <div className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Recent Posts</div>
      {posts?.length ? (
        <div className="space-y-3">
          {posts.map((post) => (
            <div key={post.id} className="rounded-lg bg-[var(--bg-canvas)] p-4">
              <div className="mb-1 font-medium text-[var(--text-primary)]">{post.title}</div>
              <div className="flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                <span>{post.content_type || 'post'}</span>
                <span>{post.published_mode || 'manual'}</span>
                {post.topic_key ? <span>topic_key: {post.topic_key}</span> : null}
                {post.coverage_date ? <span>coverage: {post.coverage_date}</span> : null}
                <span>{formatDate(post.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-[var(--text-faint)]">No posts yet.</div>
      )}
    </section>
  )
}

export default function AdminPublishingStatus() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeRunId, setActiveRunId] = useState(null)

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminPublishingStatus({ limit: 8 })
      setData(result)
    } catch (err) {
      setError(err.message || 'Failed to load publishing status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const latestDaily = data?.latest_runs?.daily_auto ?? null
  const latestWeekly = data?.latest_runs?.weekly_review ?? null
  const spotlightRun = latestDaily || latestWeekly || data?.recent_runs?.[0] || null

  return (
    <div data-ui="admin-publishing-status">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Publishing Status</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            Monitor candidate topics, published/skipped decisions, and auto vs manual outcomes.
          </p>
        </div>
        <button
          type="button"
          onClick={loadStatus}
          className="rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
        >
          Refresh
        </button>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}

      {loading && !data ? (
        <div className="text-sm text-[var(--text-faint)]">Loading...</div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <RunCard title="Latest Daily Auto Run" run={latestDaily} />
            <RunCard title="Latest Weekly Review Run" run={latestWeekly} />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.2fr,1fr]">
            <div className="space-y-6">
              <TopicList
                title="Candidate Topics"
                items={spotlightRun?.candidate_topics || []}
                emptyText="No candidate snapshot yet."
              />
              <TopicList
                title="Published Topics"
                items={spotlightRun?.published_topics || []}
                emptyText="No published topic snapshot yet."
              />
              <TopicList
                title="Skipped Topics & Reasons"
                items={spotlightRun?.skipped_topics || []}
                emptyText="No skipped topic snapshot yet."
              />
            </div>

            <div className="space-y-6">
              <RecentPosts posts={data?.recent_posts || []} />
              <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Clock3 size={16} className="text-[var(--accent)]" />
                  Recent Runs
                </div>
                {data?.recent_runs?.length ? (
                  <div className="space-y-3">
                    {data.recent_runs.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setActiveRunId(run.id)}
                        className="w-full rounded-lg bg-[var(--bg-canvas)] p-4 text-left transition-colors hover:bg-[var(--accent-soft)]/40"
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">{run.workflow_key}</div>
                            <div className="text-xs text-[var(--text-faint)]">
                              {run.coverage_date || 'No coverage date'} • {run.run_mode === 'manual' ? 'manual' : 'auto'}
                            </div>
                          </div>
                          <StatusPill status={run.status} />
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-[var(--text-faint)]">
                          <span>cand {run.summary?.candidate_count ?? 0}</span>
                          <span>pub {run.summary?.published_count ?? 0}</span>
                          <span>skip {run.summary?.skipped_count ?? 0}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-[var(--text-faint)]">No historical runs yet.</div>
                )}
              </section>
            </div>
          </div>

          {activeRunId ? <AdminPublishingRunDetail runId={activeRunId} onClose={() => setActiveRunId(null)} /> : null}
        </div>
      )}
    </div>
  )
}
