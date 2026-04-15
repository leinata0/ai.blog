import { useCallback, useEffect, useMemo, useState } from 'react'
import { Eye, RefreshCcw, Save, Search } from 'lucide-react'

import {
  fetchAdminPostQuality,
  fetchAdminQualityInbox,
  updateAdminPostQualityReview,
} from '../../api/admin'
import {
  getContentTypeLabel,
  getQualityIssueLabel,
  getQualityStrengthLabel,
  getScoreTone,
  getVerdictLabel,
} from './adminDisplay'

const defaultFilters = {
  q: '',
  content_type: '',
  series_slug: '',
}

const defaultReviewForm = {
  editor_verdict: '',
  editor_labels_text: '',
  editor_note: '',
  followup_recommended: false,
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
      <div className="text-xs font-medium text-[var(--text-faint)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value ?? '-'}</div>
      {hint ? <div className="mt-1 text-xs text-[var(--text-faint)]">{hint}</div> : null}
    </div>
  )
}

export default function AdminQualityInbox() {
  const [filters, setFilters] = useState(defaultFilters)
  const [data, setData] = useState({ summary: {}, items: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activePostId, setActivePostId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [savingReview, setSavingReview] = useState(false)
  const [reviewForm, setReviewForm] = useState(defaultReviewForm)

  const loadInbox = useCallback(async (nextFilters = filters) => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminQualityInbox(nextFilters)
      setData({
        summary: result?.summary || {},
        items: Array.isArray(result?.items) ? result.items : [],
      })
    } catch (err) {
      setData({ summary: {}, items: [] })
      setError(err.message || '加载质量收件箱失败')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    loadInbox(defaultFilters)
  }, [])

  const activeTitle = useMemo(() => {
    return detail?.post?.title || data.items.find((item) => item.post_id === activePostId)?.title || ''
  }, [activePostId, detail, data.items])

  async function openDetail(postId) {
    setActivePostId(postId)
    setDetailLoading(true)
    setError('')
    try {
      const result = await fetchAdminPostQuality(postId)
      setDetail(result)
      const review = result?.quality_review
      setReviewForm({
        editor_verdict: review?.editor_verdict || '',
        editor_labels_text: Array.isArray(review?.editor_labels) ? review.editor_labels.join('，') : '',
        editor_note: review?.editor_note || '',
        followup_recommended: Boolean(review?.followup_recommended),
      })
    } catch (err) {
      setDetail(null)
      setError(err.message || '加载复盘详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  async function handleSaveReview() {
    if (!activePostId) return
    setSavingReview(true)
    setError('')
    try {
      await updateAdminPostQualityReview(activePostId, {
        editor_verdict: reviewForm.editor_verdict,
        editor_labels: reviewForm.editor_labels_text
          .split(/[，,]/)
          .map((item) => item.trim())
          .filter(Boolean),
        editor_note: reviewForm.editor_note,
        followup_recommended: reviewForm.followup_recommended,
      })
      await Promise.all([openDetail(activePostId), loadInbox()])
    } catch (err) {
      setError(err.message || '保存人工复盘失败')
    } finally {
      setSavingReview(false)
    }
  }

  function handleApplyFilters() {
    loadInbox(filters)
  }

  function handleResetFilters() {
    setFilters(defaultFilters)
    loadInbox(defaultFilters)
  }

  return (
    <section data-ui="admin-quality-inbox">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">质量收件箱</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            汇总自动发布后的质量快照，并支持编辑人工复盘结论。
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadInbox()}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
        >
          <RefreshCcw size={14} />
          刷新
        </button>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard label="文章总数" value={data.summary?.total_posts ?? 0} />
        <SummaryCard label="已有快照" value={data.summary?.with_snapshot_count ?? 0} />
        <SummaryCard label="已人工复盘" value={data.summary?.reviewed_count ?? 0} />
        <SummaryCard label="建议跟进" value={data.summary?.followup_recommended_count ?? 0} />
        <SummaryCard label="平均总分" value={data.summary?.avg_overall_score ?? '-'} hint="0-100" />
      </div>

      <section className="mt-6 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            搜索文章
            <div className="mt-1 flex items-center rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-2">
              <Search size={14} className="text-[var(--text-faint)]" />
              <input
                value={filters.q}
                onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
                placeholder="标题 / slug"
                className="w-full bg-transparent px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            内容类型
            <select
              value={filters.content_type}
              onChange={(event) => setFilters((prev) => ({ ...prev, content_type: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">全部类型</option>
              <option value="daily_brief">日报</option>
              <option value="weekly_review">周报</option>
              <option value="post">文章</option>
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            系列 slug
            <input
              value={filters.series_slug}
              onChange={(event) => setFilters((prev) => ({ ...prev, series_slug: event.target.value }))}
              placeholder="例如 ai-daily-brief"
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyFilters}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            应用筛选
          </button>
          <button
            type="button"
            onClick={handleResetFilters}
            className="rounded-lg border border-[var(--border-muted)] px-4 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            重置
          </button>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <section className="space-y-4">
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && data.items.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] px-5 py-10 text-center text-sm text-[var(--text-faint)]">
              暂无质量记录。
            </div>
          ) : null}
          {data.items.map((item) => {
            const tone = getScoreTone(item.overall_score)
            return (
              <article
                key={item.post_id}
                className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone.chip}`}>
                        总分 {item.overall_score ?? '-'}
                      </span>
                      <span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
                        {getContentTypeLabel(item.content_type)}
                      </span>
                      <span className="rounded-full bg-[var(--bg-canvas)] px-2 py-1 text-xs text-[var(--text-secondary)]">
                        {getVerdictLabel(item.editor_verdict)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-[var(--text-primary)]">{item.title}</h3>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--text-faint)]">
                      <span>覆盖日期：{item.coverage_date || '-'}</span>
                      <span>系列：{item.series_slug || '-'}</span>
                      <span>结构 {item.structure_score ?? '-'}</span>
                      <span>来源 {item.source_score ?? '-'}</span>
                      <span>分析 {item.analysis_score ?? '-'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openDetail(item.post_id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
                  >
                    <Eye size={13} />
                    查看复盘
                  </button>
                </div>

                {item.issues?.length ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.issues.map((issue) => (
                      <span key={issue} className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">
                        {getQualityIssueLabel(issue)}
                      </span>
                    ))}
                  </div>
                ) : null}

                {item.strengths?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.strengths.map((strength) => (
                      <span key={strength} className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                        {getQualityStrengthLabel(strength)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            )
          })}
        </section>

        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">人工复盘</h3>
            <p className="mt-1 text-xs text-[var(--text-faint)]">
              {activePostId ? `当前文章：${activeTitle}` : '从左侧选择一篇文章后，可填写人工复盘结论。'}
            </p>
          </div>

          {detailLoading ? <div className="text-sm text-[var(--text-faint)]">加载详情中...</div> : null}
          {!detailLoading && activePostId && detail?.quality_snapshot ? (
            <div className="mb-4 rounded-lg bg-[var(--bg-canvas)] p-4 text-sm text-[var(--text-secondary)]">
              <div>总分：{detail.quality_snapshot.overall_score ?? '-'}</div>
              <div className="mt-1">结构：{detail.quality_snapshot.structure_score ?? '-'}，来源：{detail.quality_snapshot.source_score ?? '-'}，分析：{detail.quality_snapshot.analysis_score ?? '-'}</div>
              {detail.quality_snapshot.notes ? <div className="mt-2">{detail.quality_snapshot.notes}</div> : null}
            </div>
          ) : null}

          <div className="space-y-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              人工结论
              <select
                value={reviewForm.editor_verdict}
                onChange={(event) => setReviewForm((prev) => ({ ...prev, editor_verdict: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
              >
                <option value="">未填写</option>
                <option value="excellent">优秀</option>
                <option value="solid">稳健</option>
                <option value="weak">待加强</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              标签
              <input
                value={reviewForm.editor_labels_text}
                onChange={(event) => setReviewForm((prev) => ({ ...prev, editor_labels_text: event.target.value }))}
                placeholder="例如 结构完整，适合继续跟进"
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              编辑备注
              <textarea
                rows={5}
                value={reviewForm.editor_note}
                onChange={(event) => setReviewForm((prev) => ({ ...prev, editor_note: event.target.value }))}
                placeholder="记录这篇文章为什么值得继续追踪，或下一次应补强哪些地方。"
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={reviewForm.followup_recommended}
                onChange={(event) => setReviewForm((prev) => ({ ...prev, followup_recommended: event.target.checked }))}
              />
              建议继续跟进这条主线
            </label>
          </div>

          <button
            type="button"
            disabled={!activePostId || savingReview}
            onClick={handleSaveReview}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            <Save size={14} />
            {savingReview ? '保存中...' : '保存人工复盘'}
          </button>
        </section>
      </div>
    </section>
  )
}
