import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, RefreshCcw, Rss, ServerCrash } from 'lucide-react'

import { fetchAdminSubscriptionHealth, probeAdminEndpointHealth } from '../../api/admin'

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--text-faint)]">{hint}</div> : null}
    </div>
  )
}

function getStatusTone(item) {
  if (item.status === 'ok') {
    return {
      badge: 'bg-emerald-50 text-emerald-700',
      icon: CheckCircle2,
      label: '正常',
    }
  }
  if (item.status === 'slow') {
    return {
      badge: 'bg-amber-50 text-amber-700',
      icon: Clock3,
      label: '偏慢',
    }
  }
  if (item.status === 'timeout') {
    return {
      badge: 'bg-rose-50 text-rose-700',
      icon: AlertTriangle,
      label: '超时',
    }
  }
  return {
    badge: 'bg-rose-50 text-rose-700',
    icon: ServerCrash,
    label: '失败',
  }
}

export default function AdminEndpointHealth() {
  const [data, setData] = useState(null)
  const [subscriptionHealth, setSubscriptionHealth] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [probeResult, subscriptionResult] = await Promise.allSettled([
        probeAdminEndpointHealth(),
        fetchAdminSubscriptionHealth(),
      ])
      setData(probeResult.status === 'fulfilled' ? probeResult.value : null)
      setSubscriptionHealth(subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : null)
      if (probeResult.status === 'rejected' && subscriptionResult.status === 'rejected') {
        throw new Error('探测接口与订阅健康状态时失败')
      }
    } catch (err) {
      setData(null)
      setSubscriptionHealth(null)
      setError(err?.message || '探测接口与订阅健康状态时失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const overview = data?.overview || { total: 0, ok: 0, slow: 0, failed: 0 }
  const failingItems = useMemo(
    () => (Array.isArray(data?.items) ? data.items.filter((item) => !item.ok) : []),
    [data],
  )

  return (
    <section data-ui="admin-endpoint-health">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">接口与订阅健康</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            这里同时展示浏览器侧的公开接口探测结果，以及后端运行时的订阅配置状态。
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
        >
          <RefreshCcw size={14} />
          重新探测
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">
          {error}
        </div>
      ) : null}

      {loading && !data ? <div className="text-sm text-[var(--text-faint)]">正在探测公开接口...</div> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="检查项总数" value={overview.total} />
        <StatCard label="正常" value={overview.ok} />
        <StatCard label="偏慢" value={overview.slow} hint="单项耗时超过 1.5 秒" />
        <StatCard label="失败" value={overview.failed} />
      </div>

      {data?.checked_at ? (
        <div className="mt-4 text-xs text-[var(--text-faint)]">
          最近检查时间：{new Date(data.checked_at).toLocaleString('zh-CN')}
        </div>
      ) : null}

      <section data-ui="admin-subscription-health" className="mt-6 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">订阅配置</h3>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {[
            { key: 'email', label: '邮件订阅' },
            { key: 'web_push', label: '浏览器提醒' },
            { key: 'wecom', label: '企业微信机器人' },
          ].map(({ key, label }) => {
            const item = subscriptionHealth?.[key]
            const ready = Boolean(item?.configured)
            return (
              <article
                key={key}
                data-ui={`subscription-health-${key}`}
                className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{label}</div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
                      ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {ready ? '已接入' : '待配置'}
                  </span>
                </div>
                <div className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                  {item?.message || '暂时还没有订阅配置诊断信息。'}
                </div>
                {item?.missing_env?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.missing_env.map((envName) => (
                      <span
                        key={`${key}-${envName}`}
                        className="rounded-full bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-[var(--text-faint)]"
                      >
                        {envName}
                      </span>
                    ))}
                  </div>
                ) : null}
                {key === 'web_push' ? (
                  <div className="mt-3 text-xs text-[var(--text-faint)]">
                    公钥状态：{item?.has_public_key ? '已检测到 VAPID 公钥' : '未检测到 VAPID 公钥'}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {(data?.items || []).map((item) => {
          const tone = getStatusTone(item)
          const Icon = tone.icon
          return (
            <article key={item.key} className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</div>
                  <div className="mt-1 break-all text-xs text-[var(--text-faint)]">{item.path}</div>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${tone.badge}`}>
                  <Icon size={12} />
                  {tone.label}
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-[var(--bg-canvas)] px-3 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">状态码</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{item.status_code ?? '-'}</div>
                </div>
                <div className="rounded-lg bg-[var(--bg-canvas)] px-3 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">耗时</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {item.duration_ms != null ? `${item.duration_ms} ms` : '-'}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--bg-canvas)] px-3 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">最近检查</div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {item.checked_at ? new Date(item.checked_at).toLocaleTimeString('zh-CN') : '-'}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-[var(--bg-canvas)] px-4 py-3">
                <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                  <Rss size={14} />
                  {item.summary || '已完成检查'}
                </div>
                {item.detail ? (
                  <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.detail}</div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <section className="mt-6 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">重点提醒</h3>
        {failingItems.length ? (
          <div className="mt-4 space-y-3">
            {failingItems.map((item) => (
              <div key={`issue-${item.key}`} className="rounded-lg bg-[var(--bg-canvas)] px-4 py-3">
                <div className="text-sm font-medium text-[var(--text-primary)]">{item.label}</div>
                <div className="mt-1 text-sm text-[var(--text-secondary)]">
                  {item.summary}
                  {item.detail ? `：${item.detail}` : ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 inline-flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 size={14} />
            当前公开接口与订阅入口均通过检查。
          </div>
        )}
      </section>
    </section>
  )
}
