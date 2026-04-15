import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, Pencil, Pin, Plus, Search, Trash2 } from 'lucide-react'

import { formatDate } from '../../utils/date'
import { proxyImageUrl } from '../../utils/proxyImage'
import {
  getContentTypeLabel,
  getPublishedModeLabel,
  getPublishStateLabel,
} from './adminDisplay'

const CONTENT_TYPE_OPTIONS = [
  { value: '', label: '全部类型' },
  { value: 'daily_brief', label: '日报' },
  { value: 'weekly_review', label: '周报' },
  { value: 'post', label: '文章' },
]

const PUBLISHED_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'published', label: '已发布' },
  { value: 'draft', label: '草稿' },
]

const MODE_OPTIONS = [
  { value: '', label: '全部模式' },
  { value: 'auto', label: '自动' },
  { value: 'manual', label: '手动' },
]

const BULK_ACTION_OPTIONS = [
  { value: 'publish', label: '批量发布' },
  { value: 'unpublish', label: '批量转草稿' },
  { value: 'pin', label: '批量置顶' },
  { value: 'unpin', label: '批量取消置顶' },
  { value: 'set_content_type', label: '批量修改类型' },
  { value: 'set_series', label: '批量归入系列' },
]

export default function AdminPostsList({
  posts,
  filters,
  loading,
  bulkApplying,
  onNew,
  onEdit,
  onDelete,
  onRefresh,
  onApplyFilters,
  onResetFilters,
  onRunBulkAction,
}) {
  const [selectedPostIds, setSelectedPostIds] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('publish')
  const [bulkValue, setBulkValue] = useState('')
  const [draftFilters, setDraftFilters] = useState(filters)

  useEffect(() => {
    setDraftFilters(filters)
  }, [filters])

  const postIds = useMemo(() => posts.map((post) => post.id).filter(Boolean), [posts])
  const allSelected = postIds.length > 0 && postIds.every((id) => selectedPostIds.has(id))

  function toggleAll() {
    if (allSelected) {
      setSelectedPostIds(new Set())
      return
    }
    setSelectedPostIds(new Set(postIds))
  }

  function toggleSingle(id) {
    setSelectedPostIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleBulkApply() {
    const ids = Array.from(selectedPostIds)
    if (!ids.length) return
    await onRunBulkAction({ action: bulkAction, postIds: ids, value: bulkValue })
    setSelectedPostIds(new Set())
  }

  function handleApplyFilters() {
    onApplyFilters(draftFilters)
  }

  function handleResetFilters() {
    const cleared = {
      search: '',
      content_type: '',
      published: '',
      published_mode: '',
      coverage_date: '',
      series_slug: '',
    }
    setDraftFilters(cleared)
    onResetFilters(cleared)
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">文章管理</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            刷新
          </button>
          <button
            onClick={onNew}
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white"
          >
            <Plus size={16} />
            新建文章
          </button>
        </div>
      </div>

      <section className="mb-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            搜索
            <div className="mt-1 flex items-center rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-2">
              <Search size={14} className="text-[var(--text-faint)]" />
              <input
                value={draftFilters.search || ''}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder="标题 / slug / topic_key"
                className="w-full bg-transparent px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            内容类型
            <select
              value={draftFilters.content_type || ''}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, content_type: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            发布状态
            <select
              value={draftFilters.published || ''}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, published: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {PUBLISHED_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            发布模式
            <select
              value={draftFilters.published_mode || ''}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, published_mode: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              {MODE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            覆盖日期
            <input
              type="date"
              value={draftFilters.coverage_date || ''}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, coverage_date: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="text-xs font-medium text-[var(--text-secondary)]">
            系列 slug
            <input
              value={draftFilters.series_slug || ''}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, series_slug: event.target.value }))}
              placeholder="ai-daily-brief"
              className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
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

      <section className="mb-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm text-[var(--text-secondary)]">已选择：{selectedPostIds.size}</div>
          <select
            value={bulkAction}
            onChange={(event) => setBulkAction(event.target.value)}
            className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            {BULK_ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {bulkAction === 'set_content_type' ? (
            <select
              value={bulkValue}
              onChange={(event) => setBulkValue(event.target.value)}
              className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            >
              <option value="">选择类型</option>
              <option value="daily_brief">日报</option>
              <option value="weekly_review">周报</option>
              <option value="post">文章</option>
            </select>
          ) : null}
          {bulkAction === 'set_series' ? (
            <input
              value={bulkValue}
              onChange={(event) => setBulkValue(event.target.value)}
              placeholder="输入系列 slug"
              className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
          ) : null}
          <button
            type="button"
            onClick={handleBulkApply}
            disabled={bulkApplying || selectedPostIds.size === 0}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {bulkApplying ? '执行中...' : '执行批量操作'}
          </button>
        </div>
      </section>

      <div className="overflow-hidden rounded-xl bg-[var(--bg-surface)]" style={{ boxShadow: 'var(--card-shadow)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-muted)]">
                <th className="px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">标题</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">类型</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">模式</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">覆盖日期</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">系列</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">质量</th>
                <th className="px-4 py-3 text-left font-medium text-[var(--text-faint)]">发布时间</th>
                <th className="px-4 py-3 text-right font-medium text-[var(--text-faint)]">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-[var(--text-faint)]">
                    加载文章中...
                  </td>
                </tr>
              ) : null}
              {!loading &&
                posts.map((post) => (
                  <tr key={post.slug || post.id} className="border-b border-[var(--border-muted)]">
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedPostIds.has(post.id)}
                        onChange={() => toggleSingle(post.id)}
                      />
                    </td>
                    <td className="px-4 py-4 font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        {post.cover_image ? (
                          <img
                            src={proxyImageUrl(post.cover_image)}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                        <div>
                          <div>{post.title}</div>
                          <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-faint)]">
                            {post.is_pinned ? <Pin size={12} className="text-[var(--accent)]" /> : null}
                            {post.is_published !== false ? (
                              <span className="inline-flex items-center gap-1">
                                <Eye size={12} /> {getPublishStateLabel('published')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <EyeOff size={12} /> {getPublishStateLabel('draft')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">{getContentTypeLabel(post.content_type || 'post')}</td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">{getPublishedModeLabel(post.published_mode || '')}</td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">{post.coverage_date || '-'}</td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">{post.series_slug || '-'}</td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">
                      {post.quality_score ?? '-'} / 来源 {post.source_count ?? '-'}
                    </td>
                    <td className="px-4 py-4 text-[var(--text-tertiary)]">{formatDate(post.created_at)}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        onClick={() => onEdit(post)}
                        className="rounded-lg p-2 transition-colors duration-200 hover:bg-gray-100"
                        title="编辑"
                      >
                        <Pencil size={15} className="text-[var(--accent)]" />
                      </button>
                      <button
                        onClick={() => onDelete(post)}
                        className="ml-1 rounded-lg p-2 transition-colors duration-200 hover:bg-red-50"
                        title="删除"
                      >
                        <Trash2 size={15} className="text-[#ef4444]" />
                      </button>
                    </td>
                  </tr>
                ))}
              {!loading && posts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-[var(--text-faint)]">
                    当前筛选条件下没有文章。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
