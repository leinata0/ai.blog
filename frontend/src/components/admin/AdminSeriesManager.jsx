import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCcw, Save, Sparkles, X } from 'lucide-react'

import {
  createAdminSeries,
  fetchAdminSeries,
  generateAdminSeriesCover,
  updateAdminSeries,
} from '../../api/admin'
import { proxyImageUrl } from '../../utils/proxyImage'

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

function CoverPreview({ src, alt }) {
  if (!src) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--border-muted)] bg-[var(--bg-canvas)] text-xs text-[var(--text-faint)]">
        暂无封面
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)]">
      <img
        src={proxyImageUrl(src)}
        alt={alt}
        className="h-24 w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    </div>
  )
}

export default function AdminSeriesManager() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatingId, setGeneratingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
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

  function resetEditor() {
    setEditing(null)
    setForm(emptyForm)
  }

  function startCreate() {
    resetEditor()
    setError('')
    setNotice('')
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
    setNotice('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setNotice('')
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
        setNotice('系列已更新。')
      } else {
        await createAdminSeries(payload)
        setNotice('系列已创建。')
      }
      await loadSeries()
      resetEditor()
    } catch (err) {
      setError(err.message || '保存系列失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateCover(item, overwrite = false) {
    if (!item?.id) return
    if (overwrite && !window.confirm(`确定重生成「${item.title || item.slug}」的封面吗？`)) return

    setGeneratingId(item.id)
    setError('')
    setNotice('')

    try {
      const result = await generateAdminSeriesCover(item.id, { overwrite })
      await loadSeries()

      if (editing?.id === item.id) {
        setForm((current) => ({
          ...current,
          cover_image: result?.cover_image || current.cover_image,
        }))
      }

      if (result?.generated && result?.cover_image) {
        setNotice(overwrite ? '系列封面已重生成。' : '系列封面已生成。')
      } else {
        setNotice(result?.error || '这次没有生成新封面，可能当前系列已经有封面。')
      }
    } catch (err) {
      setError(err.message || '生成系列封面失败')
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <section data-ui="admin-series-manager">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">系列管理</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">管理内容系列、中文展示资料与系列封面图。</p>
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
      {notice ? (
        <div className="mb-4 rounded-lg bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-secondary)]">{notice}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.35fr,1fr]">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">现有系列</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !sortedSeries.length ? (
            <div className="text-sm text-[var(--text-faint)]">还没有系列，可以先创建第一条。</div>
          ) : null}
          {sortedSeries.length ? (
            <div className="space-y-3">
              {sortedSeries.map((item) => {
                const isGenerating = generatingId === item.id
                const hasCover = Boolean(item.cover_image)
                return (
                  <div
                    key={item.id || item.slug}
                    className="grid gap-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4 md:grid-cols-[160px,1fr]"
                  >
                    <CoverPreview src={item.cover_image} alt={item.title || item.slug} />
                    <div>
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
                      {item.description ? (
                        <p className="mb-3 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>
                      ) : (
                        <p className="mb-3 text-sm text-[var(--text-faint)]">暂未填写系列简介。</p>
                      )}
                      <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                        <span>排序：{item.sort_order ?? '-'}</span>
                        <span>{item.is_featured ? '推荐系列' : '普通系列'}</span>
                        {Array.isArray(item.content_types) && item.content_types.length ? (
                          <span>类型：{item.content_types.join(' / ')}</span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateCover(item, false)}
                          disabled={isGenerating}
                          className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface)] disabled:opacity-60"
                        >
                          <Sparkles size={13} />
                          {isGenerating && !hasCover ? '生成中...' : hasCover ? '补生成封面' : '生成封面'}
                        </button>
                        {hasCover ? (
                          <button
                            type="button"
                            onClick={() => handleGenerateCover(item, true)}
                            disabled={isGenerating}
                            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                          >
                            <Sparkles size={13} />
                            {isGenerating ? '重生成中...' : '重生成封面'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
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
                placeholder="tooling-workflow"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              中文标题
              <input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="工具与工作流"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              简介
              <textarea
                rows={4}
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
            <CoverPreview src={form.cover_image} alt={form.title || form.slug || '系列封面预览'} />
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

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
              <>
                <button
                  type="button"
                  onClick={() => handleGenerateCover(editing, false)}
                  disabled={generatingId === editing.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)] disabled:opacity-60"
                >
                  <Sparkles size={14} />
                  {generatingId === editing.id ? '生成中...' : '生成封面'}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateCover(editing, true)}
                  disabled={generatingId === editing.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)] disabled:opacity-60"
                >
                  <Sparkles size={14} />
                  {generatingId === editing.id ? '重生成中...' : '重生成封面'}
                </button>
                <button
                  type="button"
                  onClick={startCreate}
                  className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]"
                >
                  <X size={14} />
                  取消编辑
                </button>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </section>
  )
}
