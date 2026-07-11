import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CircleDashed, Loader2, RefreshCw, X, XCircle, ListTodo } from 'lucide-react'

import { fetchAdminGenerationJobs } from '../../api/admin'
import {
  clearFinishedAdminJobs,
  countActiveAdminJobs,
  dismissAdminJob,
  getAdminJobs,
  jobStatusLabel,
  mergeServerHistory,
  subscribeAdminJobs,
} from './adminJobsStore'

function statusTone(status) {
  switch (status) {
    case 'succeeded':
      return { color: 'var(--accent)', bg: 'var(--accent-soft)' }
    case 'failed':
      return { color: '#ef4444', bg: 'var(--danger-soft)' }
    case 'timeout':
      return { color: '#b45309', bg: 'rgba(245,158,11,0.12)' }
    case 'running':
    case 'queued':
      return { color: 'var(--accent)', bg: 'var(--accent-soft)' }
    default:
      return { color: 'var(--text-secondary)', bg: 'var(--bg-canvas)' }
  }
}

function StatusIcon({ status }) {
  if (status === 'succeeded') return <CheckCircle2 size={14} />
  if (status === 'failed') return <XCircle size={14} />
  if (status === 'running' || status === 'queued') {
    return <Loader2 size={14} className="animate-spin" />
  }
  return <CircleDashed size={14} />
}

function kindBadge(kind) {
  if (kind === 'text_generation') return '文本'
  return '图片'
}

export default function AdminJobsDock() {
  const [jobs, setJobs] = useState(() => getAdminJobs())
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')

  useEffect(() => subscribeAdminJobs(setJobs), [])

  async function hydrateFromServer({ silent = false } = {}) {
    if (!silent) setSyncing(true)
    setSyncError('')
    try {
      const payload = await fetchAdminGenerationJobs({ limit: 40 })
      mergeServerHistory(payload?.items || [])
    } catch (err) {
      if (!silent) setSyncError(err?.message || '同步任务历史失败')
    } finally {
      if (!silent) setSyncing(false)
    }
  }

  // Cross-device history on mount + light poll while dock is open / active jobs exist.
  useEffect(() => {
    hydrateFromServer({ silent: true })
  }, [])

  useEffect(() => {
    const active = countActiveAdminJobs(jobs)
    if (!open && active === 0) return undefined
    const timer = window.setInterval(() => {
      hydrateFromServer({ silent: true })
    }, open ? 8000 : 20000)
    return () => window.clearInterval(timer)
  }, [open, jobs])

  const activeCount = useMemo(() => countActiveAdminJobs(jobs), [jobs])
  const recent = useMemo(() => jobs.slice(0, 16), [jobs])

  // Always show dock once server or local has history potential — keep hidden only when empty.
  if (jobs.length === 0 && !open) {
    return (
      <div className="relative" data-ui="admin-jobs-dock">
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            hydrateFromServer()
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)]"
          aria-expanded={false}
          aria-controls="admin-jobs-panel"
        >
          <ListTodo size={15} />
          <span>任务</span>
        </button>
      </div>
    )
  }

  return (
    <div className="relative" data-ui="admin-jobs-dock">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value)
          if (!open) hydrateFromServer({ silent: true })
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-surface)]"
        aria-expanded={open}
        aria-controls="admin-jobs-panel"
      >
        <ListTodo size={15} />
        <span>任务</span>
        {activeCount > 0 ? (
          <span
            className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {activeCount}
          </span>
        ) : (
          <span className="text-xs text-[var(--text-faint)]">{jobs.length}</span>
        )}
      </button>

      {open ? (
        <div
          id="admin-jobs-panel"
          role="dialog"
          aria-label="后台生成任务"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[80] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-surface)] shadow-[var(--card-shadow)]"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-muted)] px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">生成任务</div>
              <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                {activeCount > 0 ? `${activeCount} 个进行中 · 含服务端历史` : '图片 / 文本 · 跨设备可同步'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => hydrateFromServer()}
                disabled={syncing}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)] disabled:opacity-50"
                aria-label="从服务器同步任务"
                title="同步服务端历史"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={clearFinishedAdminJobs}
                className="rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
              >
                清理已完成
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-[var(--text-faint)] hover:bg-[var(--bg-canvas)]"
                aria-label="关闭任务面板"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {syncError ? (
            <div className="border-b border-[var(--border-muted)] px-4 py-2 text-xs text-[#ef4444]">{syncError}</div>
          ) : null}

          {recent.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[var(--text-faint)]">
              暂无任务记录。生成封面或调用文本 API 后会出现在这里。
            </div>
          ) : (
            <ul className="max-h-[22rem] space-y-2 overflow-y-auto p-3">
              {recent.map((job) => {
                const tone = statusTone(job.status)
                return (
                  <li
                    key={job.localId}
                    className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {job.label}
                        </div>
                        {job.detail ? (
                          <div className="mt-0.5 truncate text-xs text-[var(--text-faint)]">{job.detail}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => dismissAdminJob(job.localId)}
                        className="shrink-0 rounded p-1 text-[var(--text-faint)] hover:bg-[var(--bg-surface)]"
                        aria-label="移除任务记录"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ backgroundColor: tone.bg, color: tone.color }}
                      >
                        <StatusIcon status={job.status} />
                        {jobStatusLabel(job.status)}
                      </span>
                      <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-faint)]">
                        {kindBadge(job.kind)}
                      </span>
                      {job.jobId ? (
                        <span className="text-[11px] text-[var(--text-faint)]">#{job.jobId}</span>
                      ) : null}
                      {job.source === 'server' ? (
                        <span className="text-[11px] text-[var(--text-faint)]">服务端</span>
                      ) : null}
                    </div>
                    {job.error ? (
                      <p className="mt-2 text-xs leading-5 text-[#ef4444]">{job.error}</p>
                    ) : null}
                    {job.resultPreview ? (
                      <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{job.resultPreview}</p>
                    ) : null}
                    {job.resultUrl ? (
                      <a
                        href={job.resultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs font-medium text-[var(--accent)] hover:underline"
                      >
                        查看结果
                      </a>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
