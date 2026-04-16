import { useEffect, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { ArrowLeft, Eye, EyeOff, Pin } from 'lucide-react'

import { fetchPostDetail } from '../../api/posts'
import {
  adminCreatePost,
  adminUpdatePost,
  adminUploadImage,
  generateAdminPostCover,
} from '../../api/admin'

const emptyForm = {
  title: '',
  slug: '',
  summary: '',
  content_md: '',
  tags: '',
  cover_image: '',
  is_published: true,
  is_pinned: false,
}

function generateSlug(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export default function AdminPostEditor({ editingPost, onBack, onSaved }) {
  const [editingId, setEditingId] = useState(editingPost?.id || null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [coverMessage, setCoverMessage] = useState('')
  const [autoSaveMsg, setAutoSaveMsg] = useState('')
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  useEffect(() => {
    if (editingPost) {
      loadPostDetail(editingPost)
    } else {
      restoreDraft()
    }
  }, [editingPost])

  useEffect(() => {
    const timer = setInterval(() => {
      localStorage.setItem('admin_draft', JSON.stringify(form))
      setAutoSaveMsg('已自动保存')
      setTimeout(() => setAutoSaveMsg(''), 2000)
    }, 30000)
    return () => clearInterval(timer)
  }, [form])

  async function loadPostDetail(post) {
    setEditingId(post.id)
    setError('')
    setUploadError('')
    setCoverMessage('')
    try {
      const detail = await fetchPostDetail(post.slug)
      setForm({
        title: detail.title,
        slug: detail.slug,
        summary: detail.summary || '',
        content_md: detail.content_md || '',
        tags: (detail.tags || []).map((tag) => tag.slug || tag.name).join(', '),
        cover_image: detail.cover_image || '',
        is_published: detail.is_published !== false,
        is_pinned: detail.is_pinned || false,
      })
    } catch {
      setError('加载文章内容失败')
    }
  }

  function restoreDraft() {
    setEditingId(null)
    setError('')
    setUploadError('')
    setCoverMessage('')

    const draft = localStorage.getItem('admin_draft')
    if (!draft) {
      setForm(emptyForm)
      return
    }

    try {
      const parsed = JSON.parse(draft)
      if (parsed.title || parsed.content_md) {
        if (window.confirm('检测到未保存的草稿，是否恢复？')) {
          setForm({ ...emptyForm, ...parsed })
        } else {
          setForm(emptyForm)
          localStorage.removeItem('admin_draft')
        }
        return
      }
    } catch {
      // fall through to reset form
    }

    setForm(emptyForm)
  }

  function insertMarkdownAtCursor(markdown) {
    const textarea = editorRef.current?.querySelector('textarea')
    const currentValue = form.content_md || ''

    if (!textarea) {
      setForm((prev) => ({ ...prev, content_md: `${currentValue}${markdown}` }))
      return
    }

    const start = textarea.selectionStart ?? currentValue.length
    const end = textarea.selectionEnd ?? currentValue.length
    const nextValue = `${currentValue.slice(0, start)}${markdown}${currentValue.slice(end)}`
    const nextCursor = start + markdown.length

    setForm((prev) => ({ ...prev, content_md: nextValue }))
    requestAnimationFrame(() => {
      const nextTextarea = editorRef.current?.querySelector('textarea')
      if (!nextTextarea) return
      nextTextarea.focus()
      nextTextarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  async function handleImageUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploadError('')
    setUploadingImage(true)
    try {
      const { url } = await adminUploadImage(file)
      insertMarkdownAtCursor(`![image](${url})`)
    } catch (err) {
      setUploadError(err.message || '正文图片上传失败')
    } finally {
      event.target.value = ''
      setUploadingImage(false)
    }
  }

  async function handleGenerateCover(overwrite = false) {
    if (!editingId) return

    setCoverGenerating(true)
    setCoverMessage('')
    setError('')
    try {
      const response = await generateAdminPostCover(editingId, { overwrite })
      if (response.generated && response.cover_image) {
        setForm((prev) => ({ ...prev, cover_image: response.cover_image }))
        setCoverMessage(overwrite ? '封面已重生成。' : '封面已生成。')
      } else {
        setCoverMessage(response.error || '封面暂时未生成。')
      }
    } catch (err) {
      setCoverMessage(err.message || '封面生成失败')
    } finally {
      setCoverGenerating(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')

    const data = {
      title: form.title,
      slug: form.slug,
      summary: form.summary,
      content_md: form.content_md,
      cover_image: form.cover_image,
      is_published: form.is_published,
      is_pinned: form.is_pinned,
      tags: form.tags.split(',').map((item) => item.trim()).filter(Boolean),
    }

    try {
      if (editingId) {
        await adminUpdatePost(editingId, data)
      } else {
        await adminCreatePost(data)
      }
      localStorage.removeItem('admin_draft')
      onSaved()
    } catch (err) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200"
        >
          <ArrowLeft size={16} />
          返回列表
        </button>
        {autoSaveMsg && (
          <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
            {autoSaveMsg}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">
          {error}
        </div>
      )}

      <div
        className="space-y-5 rounded-xl bg-[var(--bg-surface)] p-6 sm:p-8"
        style={{ boxShadow: 'var(--card-shadow)' }}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {editingId ? '编辑文章' : '发布新文章'}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text-secondary)]">标题</label>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
              style={inputStyle}
              placeholder="文章标题"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text-secondary)]">固定链接 Slug</label>
            <div className="flex gap-2">
              <input
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
                style={inputStyle}
                placeholder="url-friendly-slug"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, slug: generateSlug(form.title) })}
                className="flex-shrink-0 rounded-lg border border-[var(--border-muted)] px-3 py-2 text-xs font-medium text-[var(--accent)] transition-colors duration-200"
              >
                自动生成
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-[var(--text-secondary)]">摘要</label>
          <input
            value={form.summary}
            onChange={(event) => setForm({ ...form, summary: event.target.value })}
            className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
            style={inputStyle}
            placeholder="简短摘要"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text-secondary)]">标签，逗号分隔</label>
            <input
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
              style={inputStyle}
              placeholder="ai, product, tooling"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-[var(--text-secondary)]">封面图 URL</label>
            <input
              value={form.cover_image}
              onChange={(event) => setForm({ ...form, cover_image: event.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm outline-none"
              style={inputStyle}
              placeholder="https://... 或留空"
            />
            {editingId && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleGenerateCover(Boolean(form.cover_image))}
                  disabled={coverGenerating}
                  className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
                >
                  {coverGenerating ? '生成中...' : form.cover_image ? '重生成封面' : '生成封面'}
                </button>
                {form.cover_image && (
                  <button
                    type="button"
                    onClick={() => handleGenerateCover(true)}
                    disabled={coverGenerating}
                    className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-200 disabled:opacity-50"
                  >
                    强制覆盖
                  </button>
                )}
              </div>
            )}
            {coverMessage && (
              <div className="pt-2 text-xs text-[var(--text-secondary)]">{coverMessage}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[var(--text-secondary)]">发布状态：</label>
            <button
              type="button"
              onClick={() => setForm({ ...form, is_published: !form.is_published })}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200"
              style={{
                backgroundColor: form.is_published ? 'var(--accent-soft)' : 'var(--danger-soft)',
                color: form.is_published ? 'var(--accent)' : '#ef4444',
                border: `1px solid ${form.is_published ? 'var(--accent-border)' : 'var(--danger-border)'}`,
              }}
            >
              {form.is_published ? (
                <>
                  <Eye size={14} />
                  公开发布
                </>
              ) : (
                <>
                  <EyeOff size={14} />
                  保存为草稿
                </>
              )}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[var(--text-secondary)]">置顶：</label>
            <button
              type="button"
              onClick={() => setForm({ ...form, is_pinned: !form.is_pinned })}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200"
              style={{
                backgroundColor: form.is_pinned ? 'var(--accent-soft)' : 'var(--bg-canvas)',
                color: form.is_pinned ? 'var(--accent)' : 'var(--text-tertiary)',
                border: `1px solid ${form.is_pinned ? 'var(--accent-border)' : 'var(--border-muted)'}`,
              }}
            >
              <Pin size={14} />
              {form.is_pinned ? '已置顶' : '未置顶'}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-[var(--text-secondary)]">内容（Markdown）</label>
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
              >
                {uploadingImage ? '上传中...' : '上传正文图片'}
              </button>
            </>
          </div>
          {uploadError && (
            <div className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[#ef4444]">
              {uploadError}
            </div>
          )}
          <div ref={editorRef} data-color-mode="light">
            <MDEditor
              value={form.content_md}
              onChange={(value) => setForm({ ...form, content_md: value || '' })}
              height={400}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white transition-all duration-200 disabled:opacity-50"
          >
            {saving ? '保存中...' : editingId ? '保存修改' : form.is_published ? '发布文章' : '保存草稿'}
          </button>
          <button
            onClick={onBack}
            className="rounded-lg border border-[var(--border-muted)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
