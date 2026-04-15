import { useCallback, useEffect, useState } from 'react'
import { BarChart3, RefreshCcw } from 'lucide-react'

import { fetchAdminTopicFeedback } from '../../api/admin'
import {
  getContentTypeLabel,
  getQualityIssueLabel,
  getRecommendationLabel,
  getScoreTone,
} from './adminDisplay'

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
      <div className="text-xs font-medium text-[var(--text-faint)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value ?? '-'}</div>
    </div>
  )
}

export default function AdminTopicFeedback() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState({ summary: {}, items: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async (nextDays = days) => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminTopicFeedback({ days: nextDays })
      setData({
        summary: result?.summary || {},
        items: Array.isArray(result?.items) ? result.items : [],
      })
    } catch (err) {
      setData({ summary: {}, items: [] })
      setError(err.message || '加载主题反馈失败')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    loadData(30)
  }, [])

  return (
    <section data-ui="admin-topic-feedback">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">主题反馈</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            按主题、系列和内容类型聚合表现，帮助判断哪些主线值得持续深挖。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(event) => {
              const nextDays = Number(event.target.value)
              setDays(nextDays)
              loadData(nextDays)
            }}
            className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value={7}>近 7 天</option>
            <option value={14}>近 14 天</option>
            <option value={30}>近 30 天</option>
            <option value={60}>近 60 天</option>
          </select>
          <button
            type="button"
            onClick={() => loadData()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            <RefreshCcw size={14} />
            刷新
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="主题总数" value={data.summary?.topic_count ?? 0} />
        <SummaryCard label="建议扩展主线" value={data.summary?.strong_topic_count ?? 0} />
        <SummaryCard label="待优化主线" value={data.summary?.weak_topic_count ?? 0} />
      </div>

      <section className="mt-6 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <BarChart3 size={16} className="text-[var(--accent)]" />
          聚合主线表现
        </div>
        {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
        {!loading && data.items.length === 0 ? (
          <div className="text-sm text-[var(--text-faint)]">暂无聚合反馈数据。</div>
        ) : null}
        {data.items.length ? (
          <div className="space-y-4">
            {data.items.map((item) => {
              const tone = getScoreTone(item.avg_overall_score)
              return (
                <article
                  key={`${item.topic_key || 'topic'}-${item.series_slug || 'none'}-${item.content_type}`}
                  className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone.chip}`}>
                          {getRecommendationLabel(item.recommendation)}
                        </span>
                        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
                          {getContentTypeLabel(item.content_type)}
                        </span>
                      </div>
                    <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{item.topic_key || '未设置 topic_key'}</h3>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-faint)]">
                        <span>系列：{item.series_slug || '-'}</span>
                        <span>发文 {item.post_count ?? 0} 篇</span>
                        <span>均分 {item.avg_overall_score ?? '-'}</span>
                        <span>跟进率 {item.followup_rate ?? '-'}%</span>
                        <span>平均浏览 {item.avg_views ?? 0}</span>
                        <span>平均点赞 {item.avg_likes ?? 0}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-[var(--text-faint)]">
                      <div>最近文章</div>
                      <div className="mt-1 text-sm text-[var(--text-primary)]">{item.latest_post_title || '-'}</div>
                      <div className="mt-1">slug：{item.latest_post_slug || '-'}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-5">
                    <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-center">
                      <div className="text-xs text-[var(--text-faint)]">总分</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{item.avg_overall_score ?? '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-center">
                      <div className="text-xs text-[var(--text-faint)]">结构</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{item.avg_structure_score ?? '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-center">
                      <div className="text-xs text-[var(--text-faint)]">来源</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{item.avg_source_score ?? '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-center">
                      <div className="text-xs text-[var(--text-faint)]">分析</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{item.avg_analysis_score ?? '-'}</div>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-surface)] p-3 text-center">
                      <div className="text-xs text-[var(--text-faint)]">包装</div>
                      <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{item.avg_packaging_score ?? '-'}</div>
                    </div>
                  </div>

                  {item.dominant_issues?.length ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.dominant_issues.map((issue) => (
                        <span key={issue} className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">
                          {getQualityIssueLabel(issue)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : null}
      </section>
    </section>
  )
}
