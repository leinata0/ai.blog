import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, RefreshCcw, Save, Sparkles, X } from 'lucide-react'

import {
  createAdminTopicProfile,
  fetchAdminCoverGenerationStatus,
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

function normalizeTopicItems(payload) {
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []
  return source
    .map((item) => ({
      ...item,
      id: item?.id ?? null,
      topic_key: String(item?.topic_key || '').trim(),
      display_title: String(item?.display_title || item?.title || item?.topic_key || '').trim(),
      description: String(item?.description || '').trim(),
      cover_image: String(item?.cover_image || '').trim(),
      aliases: Array.isArray(item?.aliases) ? item.aliases : [],
      is_featured: Boolean(item?.is_featured),
      sort_order: Number(item?.sort_order ?? 100),
      profile_exists: Boolean(item?.profile_exists ?? item?.id),
      is_virtual: Boolean(item?.is_virtual ?? !item?.id),
      post_count: Number(item?.post_count ?? 0),
      source_count: Number(item?.source_count ?? 0),
      latest_post_at: item?.latest_post_at || null,
      latest_post_title: String(item?.latest_post_title || '').trim(),
      latest_post_slug: String(item?.latest_post_slug || '').trim(),
      display_title_source: String(item?.display_title_source || (item?.id ? 'manual' : 'raw')).trim(),
    }))
    .filter((item) => item.topic_key)
}

function normalizeStatus(payload) {
  return {
    provider: payload?.provider || 'grok',
    has_xai_api_key: Boolean(payload?.has_xai_api_key),
    can_generate: Boolean(payload?.can_generate),
    message: payload?.message || '暂时无法读取封面生成状态，请稍后重试。',
  }
}

function formatDate(value) {
  if (!value) return '暂无'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无'
  return date.toLocaleString('zh-CN', { hour12: false })
}

function displayTitleSourceLabel(source) {
  if (source === 'manual') return '人工维护'
  if (source === 'bridged') return '自动桥接'
  if (source === 'derived') return '自动概括'
  return '原始标识'
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

function StatusPanel({ status }) {
  if (!status) return null
  const tone = status.can_generate
    ? {
        bg: 'rgba(34, 197, 94, 0.08)',
        border: 'rgba(34, 197, 94, 0.18)',
        title: '主题封面生成已就绪',
      }
    : {
        bg: 'rgba(245, 158, 11, 0.10)',
        border: 'rgba(245, 158, 11, 0.18)',
        title: '主题封面生成暂不可用',
      }

  return (
    <div
      className="mb-4 rounded-xl border px-4 py-3"
      style={{ backgroundColor: tone.bg, borderColor: tone.border }}
    >
      <div className="text-sm font-medium text-[var(--text-primary)]">{tone.title}</div>
      <div className="mt-1 text-sm text-[var(--text-secondary)]">{status.message}</div>
      <div className="mt-2 text-xs text-[var(--text-faint)]">
        提供方：{String(status.provider || 'grok').toUpperCase()}
      </div>
    </div>
  )
}

function formatGenerateMessage(result, overwrite) {
  if (result?.generated && result?.cover_image) {
    return overwrite ? '主题封面已重新生成。' : '主题封面已生成。'
  }
  if (result?.error) return result.error
  if (result?.error_code === 'cover_exists') return '当前主题已有封面，如需覆盖请点击“重新生成封面”。'
  return '本次没有生成新封面。'
}

export default function AdminTopicProfiles() {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generatingId, setGeneratingId] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [coverStatus, setCoverStatus] = useState(null)

  const loadTopics = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setTopics(normalizeTopicItems(await fetchAdminTopicProfiles()))
    } catch (err) {
      setTopics([])
      setError(err.message || '加载主题汇总失败，请检查后端接口是否正常。')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadCoverStatus = useCallback(async () => {
    try {
      setCoverStatus(normalizeStatus(await fetchAdminCoverGenerationStatus()))
    } catch {
      setCoverStatus(normalizeStatus(null))
    }
  }, [])

  useEffect(() => {
    loadTopics()
    loadCoverStatus()
  }, [loadTopics, loadCoverStatus])

  const sortedTopics = useMemo(() => {
    return [...topics].sort((a, b) => {
      const featuredSort = Number(b.is_featured) - Number(a.is_featured)
      if (featuredSort !== 0) return featuredSort
      const ao = Number(a.sort_order ?? 9999)
      const bo = Number(b.sort_order ?? 9999)
      if (ao !== bo) return ao - bo
      return String(a.display_title || a.topic_key || '').localeCompare(String(b.display_title || b.topic_key || ''))
    })
  }, [topics])

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
    const topicKey = form.topic_key.trim()
    const displayTitle = form.display_title.trim()
    if (!topicKey) {
      setError('请先填写 topic_key，用于自动同步后续文章。')
      return
    }
    if (!displayTitle) {
      setError('请先填写中文展示标题。')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    const aliases = form.aliases
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)

    const payload = {
      topic_key: topicKey,
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
        setNotice(editing?.is_virtual ? '已将自动汇总主题保存为正式主题。' : '主题资料已创建。')
      }
      await loadTopics()
      resetEditor()
    } catch (err) {
      setError(err.message || '保存主题资料失败。')
    } finally {
      setSaving(false)
    }
  }

  async function handleGenerateCover(item, overwrite = false) {
    if (!item?.id) {
      setError('自动汇总主题需先保存为正式主题，才能生成封面。')
      return
    }
    if (overwrite && !window.confirm(`确定重新生成“${item.display_title || item.topic_key}”的封面吗？`)) return

    setGeneratingId(item.id)
    setError('')
    setNotice('')

    try {
      const result = await generateAdminTopicProfileCover(item.id, { overwrite })
      await Promise.all([loadTopics(), loadCoverStatus()])

      if (editing?.id === item.id) {
        setForm((current) => ({
          ...current,
          cover_image: result?.cover_image || current.cover_image,
        }))
      }

      const message = formatGenerateMessage(result, overwrite)
      if (result?.error_code === 'missing_backend_env' || result?.error_code === 'unexpected_error') {
        setError(message)
      } else {
        setNotice(message)
      }
    } catch (err) {
      setError(err.message || '生成主题封面失败。')
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <section data-ui="admin-topic-profiles">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">主题管理</h2>
          <p className="mt-1 text-sm text-[var(--text-faint)]">
            左侧展示主题汇总列表（含自动汇总主题与手工主题）。topic_key 仅用于内部识别，前台优先展示中文标题。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              loadTopics()
              loadCoverStatus()
            }}
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

      <StatusPanel status={coverStatus} />

      {error ? (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-secondary)]">{notice}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.45fr,1fr]">
        <section className="rounded-xl border border-[var(--border-muted)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">主题汇总列表</h3>
          {loading ? <div className="text-sm text-[var(--text-faint)]">加载中...</div> : null}
          {!loading && !sortedTopics.length ? (
            <div className="text-sm text-[var(--text-faint)]">
              暂无可展示主题。请先发布包含 topic_key 的文章，或手动创建第一条主题资料。
            </div>
          ) : null}
          {sortedTopics.length ? (
            <div className="space-y-3">
              {sortedTopics.map((item) => {
                const isGenerating = generatingId === item.id
                const aliases = Array.isArray(item.aliases) ? item.aliases : []
                const hasCover = Boolean(item.cover_image)

                return (
                  <div
                    key={`${item.id || 'virtual'}-${item.topic_key}`}
                    className="grid gap-4 rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)] p-4 md:grid-cols-[160px,1fr]"
                  >
                    <CoverPreview src={item.cover_image} alt={item.display_title || item.topic_key} />
                    <div>
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-[var(--text-primary)]">
                            {item.display_title || item.topic_key}
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-faint)]">topic_key：{item.topic_key}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-muted)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                        >
                          <Pencil size={12} />
                          {item.profile_exists ? '编辑' : '创建正式主题'}
                        </button>
                      </div>

                      {item.description ? (
                        <p className="mb-3 text-sm leading-6 text-[var(--text-secondary)]">{item.description}</p>
                      ) : (
                        <p className="mb-3 text-sm text-[var(--text-faint)]">暂无简介，可在右侧编辑区补充。</p>
                      )}

                      <div className="mb-3 flex flex-wrap gap-2 text-xs text-[var(--text-faint)]">
                        <span>{item.profile_exists ? '手工主题' : '自动汇总主题'}</span>
                        <span>{item.is_featured ? '推荐主题' : '普通主题'}</span>
                        <span>标题来源：{displayTitleSourceLabel(item.display_title_source)}</span>
                        <span>文章数：{item.post_count}</span>
                        <span>来源数：{item.source_count}</span>
                        <span>最近更新时间：{formatDate(item.latest_post_at)}</span>
                      </div>

                      {item.latest_post_title ? (
                        <div className="mb-3 text-xs text-[var(--text-secondary)]">
                          最近文章：{item.latest_post_title}
                        </div>
                      ) : null}

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
                            {isGenerating ? '重新生成中...' : '重新生成封面'}
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
            {editing
              ? `${editing.profile_exists ? '编辑主题' : '保存自动汇总主题'}：${editing.display_title || editing.topic_key}`
              : '创建主题'}
          </h3>
          <p className="mb-4 text-xs leading-6 text-[var(--text-faint)]">
            选中“自动汇总主题”后保存，即可创建正式主题资料。topic_key 用于自动同步，前台默认展示中文标题。
          </p>
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
              {saving ? '保存中...' : editing?.profile_exists ? '保存修改' : '保存为正式主题'}
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
                  {generatingId === editing.id ? '重新生成中...' : '重新生成封面'}
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
