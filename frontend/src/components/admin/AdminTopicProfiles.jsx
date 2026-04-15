import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCcw, Save, X } from 'lucide-react'

import {
  createAdminTopicProfile,
  fetchAdminTopicProfiles,
  updateAdminTopicProfile,
} from '../../api/admin'

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

export default function AdminTopicProfiles() {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
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

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
    setError('')
  }

  function startEdit(item) {
    setEditing(item)
    setForm({
      topic_key: item.topic_key || '',
      display_title: item.display_title || '',
      description: item.description || '',
      cover_image: item.cover_image || '',
      aliases: Array.isArray(item.aliases) ? item.aliases.join(', ') : item.aliases || '',
      is_featured: Boolean(item.is_featured),
      sort_order: Number(item.sort_order ?? 100),
    })
    setError('')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const payload = {
      topic_key: form.topic_key.trim(),
      display_title: form.display_title.trim(),
      description: form.description.trim(),
      cover_image: form.cover_image.trim(),
      aliases: form.aliases.split(',').map((item) => item.trim()).filter(Boolean),
      is_featured: Boolean(form.is_featured),
      sort_order: Number(form.sort_order || 100),
    }

    try {
      if (editing?.id) await updateAdminTopicProfile(editing.id, payload)
      else await createAdminTopicProfile(payload)
      await loadProfiles()
      startCreate()
    } catch (err) {
      setError(err.message || '保存主题资料失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section data-ui="admin-topic-profiles">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">主题管理</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">维护主题展示标题、简介、封面图和推荐顺序。</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={loadProfiles} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]">
            <RefreshCcw size={14} />
            刷新
          </button>
          <button type="button" onClick={startCreate} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">
            <Plus size={14} />
            新建主题
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[1.3fr,1fr]">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">已有主题资料</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !sortedProfiles.length ? <div className="text-sm text-[var(--text-faint)]">还没有主题资料，可以先创建一条。</div> : null}
          {sortedProfiles.length ? (
            <div className="space-y-3">
              {sortedProfiles.map((item) => (
                <div key={item.id || item.topic_key} className="rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{item.display_title || item.topic_key}</div>
                      <div className="mt-1 text-xs text-[var(--text-faint)]">topic_key：{item.topic_key || '-'}</div>
                    </div>
                    <button type="button" onClick={() => startEdit(item)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]">
                      <Pencil size={12} />
                      编辑
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                    <span>排序：{item.sort_order ?? '-'}</span>
                    <span>{item.is_featured ? '推荐主题' : '普通主题'}</span>
                    {item.latest_post_at ? <span>最近更新：{new Date(item.latest_post_at).toLocaleDateString('zh-CN')}</span> : null}
                  </div>
                </div>
              ))}
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
              <input value={form.topic_key} onChange={(event) => setForm((prev) => ({ ...prev, topic_key: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              展示标题
              <input value={form.display_title} onChange={(event) => setForm((prev) => ({ ...prev, display_title: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              简介
              <textarea rows={3} value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              封面图 URL
              <input value={form.cover_image} onChange={(event) => setForm((prev) => ({ ...prev, cover_image: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              别名关键词（逗号分隔）
              <input value={form.aliases} onChange={(event) => setForm((prev) => ({ ...prev, aliases: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              排序权重
              <input type="number" value={form.sort_order} onChange={(event) => setForm((prev) => ({ ...prev, sort_order: event.target.value }))} className="mt-1 w-full rounded-lg border border-[var(--border-muted)] bg-[var(--bg-canvas)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <input type="checkbox" checked={form.is_featured} onChange={(event) => setForm((prev) => ({ ...prev, is_featured: event.target.checked }))} />
              设为推荐主题
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
              <Save size={14} />
              {saving ? '保存中...' : editing ? '保存修改' : '创建主题'}
            </button>
            {editing ? (
              <button type="button" onClick={startCreate} className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-canvas)]">
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
