import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCcw, Save, Sparkles, X } from 'lucide-react'

import {
  createAdminTopicProfile,
  fetchAdminTopicProfiles,
  generateAdminTopicProfileCover,
  updateAdminTopicProfile,
} from '../../api/admin'
import { proxyImageUrl } from '../../utils/proxyImage'

const emptyForm = {
  topic_key: '',
  display_title: '',
  description: '',
  cover_image: '',
  aliases: '',
  is_featured: false,
  sort_order: 100,
}

function normalizeProfiles(payload) {
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

export default function AdminTopicProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatingId, setGeneratingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setProfiles(normalizeProfiles(await fetchAdminTopicProfiles()))
    } catch (err) {
      setProfiles([])
      setError(err.message || '加载主题资料失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProfiles()
  }, [loadProfiles])

  const sortedProfiles = useMemo(() => {
    return [...profiles].sort((a, b) => {
      const ao = Number(a.sort_order ?? 9999)
      const bo = Number(b.sort_order ?? 9999)
      if (ao !== bo) return ao - bo
      return String(a.display_title || a.topic_key || '').localeCompare(String(b.display_title || b.topic_key || ''))
    })
  }, [profiles])

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
      topic_key: item.topic_key || '',
      display_title: item.display_title || item.title || '',
      description: item.description || '',
      cover_image: item.cover_image || '',
      aliases: Array.isArray(item.aliases) ? item.aliases.join(', ') : item.aliases || '',
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

    const displayTitle = form.display_title.trim()
    const aliases = form.aliases
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    const payload = {
      topic_key: form.topic_key.trim(),
      display_title: displayTitle,
      title: displayTitle,
      description: form.description.trim(),
      cover_image: form.cover_image.trim(),
      aliases,
      is_featured: Boolean(form.is_featured),
      sort_order: Number(form.sort_order || 100),
    }

    try {
      if (editing?.id) {
        await updateAdminTopicProfile(editing.id, payload)
        setNotice('主题资料已更新。')
      } else {
        await createAdminTopicProfile(payload)
        setNotice('主题资料已创建。')
      }
      await loadProfiles()
      resetEditor()
    } catch (err) {
      setError(err.message || '保存主题资料失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateCover(item, overwrite = false) {
    if (!item?.id) return
    if (overwrite && !window.confirm(`确定重生成「${item.display_title || item.topic_key}」的封面吗？`)) return

    setGeneratingId(item.id)
    setError('')
    setNotice('')

    try {
      const result = await generateAdminTopicProfileCover(item.id, { overwrite })
      await loadProfiles()

      if (editing?.id === item.id) {
        setForm((current) => ({
          ...current,
          cover_image: result?.cover_image || current.cover_image,
        }))
      }

      if (result?.generated && result?.cover_image) {
        setNotice(overwrite ? '主题封面已重生成。' : '主题封面已生成。')
      } else {
        setNotice(result?.error || '这次没有生成新封面，可能当前主题已经有封面。')
      }
    } catch (err) {
      setError(err.message || '生成主题封面失败')
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <section data-ui="admin-topic-profiles">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">主题管理</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">维护主题中文标题、简介、别名、推荐位与主题封面。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadProfiles}
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
            新建主题
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
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">已有主题资料</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !sortedProfiles.length ? (
            <div className="text-sm text-[var(--text-faint)]">还没有主题资料，可以先创建一条。</div>
          ) : null}
          {sortedProfiles.length ? (
            <div className="space-y-3">
              {sortedProfiles.map((item) => {
                const isGenerating = generatingId === item.id
                const aliases = Array.isArray(item.aliases) ? item.aliases : []
                const hasCover = Boolean(item.cover_image)

                return (
                  <div
                    key={item.id || item.topic_key}
                    className="grid gap-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4 md:grid-cols-[160px,1fr]"
                  >
                    <CoverPreview src={item.cover_image} alt={item.display_title || item.topic_key} />
                    <div>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)]">{item.display_title || item.topic_key}</div>
                          <div className="mt-1 text-xs text-[var(--text-faint)]">topic_key：{item.topic_key || '-'}</div>
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
                        <p className="mb-3 text-sm text-[var(--text-faint)]">暂未填写主题简介。</p>
                      )}
                      <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                        <span>排序：{item.sort_order ?? '-'}</span>
                        <span>{item.is_featured ? '推荐主题' : '普通主题'}</span>
                        {item.latest_post_at ? (
                          <span>最近更新：{new Date(item.latest_post_at).toLocaleDateString('zh-CN')}</span>
                        ) : null}
                      </div>
                      {aliases.length > 0 ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          {aliases.map((alias) => (
                            <span
                              key={alias}
                              className="rounded-full border border-[var(--border-muted)] px-2 py-1 text-xs text-[var(--text-faint)]"
                            >
                              {alias}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
            {editing ? `编辑主题：${editing.display_title || editing.topic_key}` : '创建主题'}
          </h3>
          <div className="space-y-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              topic_key
              <input
                value={form.topic_key}
                onChange={(event) => setForm((prev) => ({ ...prev, topic_key: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="openai-agents"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              中文展示标题
              <input
                value={form.display_title}
                onChange={(event) => setForm((prev) => ({ ...prev, display_title: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="OpenAI 智能体"
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
            <CoverPreview src={form.cover_image} alt={form.display_title || form.topic_key || '主题封面预览'} />
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              别名关键词（逗号分隔）
              <input
                value={form.aliases}
                onChange={(event) => setForm((prev) => ({ ...prev, aliases: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                placeholder="GPT-5, agents, agentic AI"
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
              设为推荐主题
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
              {saving ? '保存中...' : editing ? '保存修改' : '创建主题'}
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
