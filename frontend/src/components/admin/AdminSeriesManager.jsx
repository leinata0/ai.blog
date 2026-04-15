import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCcw, Save, X } from 'lucide-react'

import { createAdminSeries, fetchAdminSeries, updateAdminSeries } from '../../api/admin'

const emptyForm = {
  slug: '',
  title: '',
  description: '',
  cover_image: '',
  content_types: '',
  is_featured: false,
  sort_order: 100,
}

function normalizeSeriesList(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  return []
}

export default function AdminSeriesManager() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadSeries = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminSeries()
      setSeries(normalizeSeriesList(result))
    } catch (err) {
      setSeries([])
      setError(err.message || '加载系列列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSeries()
  }, [loadSeries])

  const sortedSeries = useMemo(() => {
    return [...series].sort((a, b) => {
      const ao = Number(a.sort_order ?? 9999)
      const bo = Number(b.sort_order ?? 9999)
      if (ao !== bo) return ao - bo
      return String(a.title || '').localeCompare(String(b.title || ''))
    })
  }, [series])

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
  }

  function startEdit(item) {
    setEditing(item)
    setForm({
      slug: item.slug || '',
      title: item.title || '',
      description: item.description || '',
      cover_image: item.cover_image || '',
      content_types: Array.isArray(item.content_types) ? item.content_types.join(', ') : item.content_types || '',
      is_featured: Boolean(item.is_featured),
      sort_order: Number(item.sort_order ?? 100),
    })
    setError('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      description: form.description.trim(),
      cover_image: form.cover_image.trim(),
      content_types: form.content_types
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      is_featured: Boolean(form.is_featured),
      sort_order: Number(form.sort_order || 100),
    }
    try {
      if (editing?.id) {
        await updateAdminSeries(editing.id, payload)
      } else {
        await createAdminSeries(payload)
      }
      await loadSeries()
      setEditing(null)
      setForm(emptyForm)
    } catch (err) {
      setError(err.message || '保存系列失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section data-ui="admin-series-manager">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">系列管理</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            管理内容系列，并把文章归入可持续扩展的主题主线。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadSeries}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
          >
            <RefreshCcw size={14} />
            刷新
          </button>
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
          >
            <Plus size={14} />
            新建系列
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.3fr,1fr]">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">现有系列</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !sortedSeries.length ? (
            <div className="text-sm text-[var(--text-faint)]">还没有系列，当前可以先创建第一条。</div>
          ) : null}
          {sortedSeries.length ? (
            <div className="space-y-3">
              {sortedSeries.map((item) => (
                <div
                  key={item.id || item.slug}
                  className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{item.title || item.slug}</div>
                      <div className="mt-1 text-xs text-[var(--text-faint)]">slug：{item.slug || '-'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                    >
                      <Pencil size={12} />
                      编辑
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                    <span>排序：{item.sort_order ?? '-'}</span>
                    <span>{item.is_featured ? '推荐系列' : '普通系列'}</span>
                    {Array.isArray(item.content_types) && item.content_types.length ? (
                      <span>类型：{item.content_types.join(', ')}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {editing ? `编辑系列：${editing.title || editing.slug}` : '创建系列'}
          </h3>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              Slug
              <input
                value={form.slug}
                onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="ai-daily-brief"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              标题
              <input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="AI Daily Brief"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              描述
              <textarea
                rows={3}
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              封面图 URL
              <input
                value={form.cover_image}
                onChange={(event) => setForm((prev) => ({ ...prev, cover_image: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="https://..."
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              内容类型（逗号分隔）
              <input
                value={form.content_types}
                onChange={(event) => setForm((prev) => ({ ...prev, content_types: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="daily_brief, weekly_review"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              排序权重
              <input
                type="number"
                value={form.sort_order}
                onChange={(event) => setForm((prev) => ({ ...prev, sort_order: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={form.is_featured}
                onChange={(event) => setForm((prev) => ({ ...prev, is_featured: event.target.checked }))}
              />
              设为推荐系列
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              <Save size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '创建系列'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={startCreate}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
              >
                <X size={14} />
                取消编辑
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  )
}
