import { useEffect, useMemo, useRef, useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import { ArrowLeft, Eye, EyeOff, Pin } from 'lucide-react'

import { fetchPostDetail } from '../../api/posts'
import { proxyImageUrl } from '../../utils/proxyImage'
import { useTheme } from '../../contexts/ThemeContext'
import {
  adminCreatePost,
  adminUpdatePost,
  adminUploadImage,
  generateAdminPostCover,
  waitForAdminImageGenerationJob,
} from '../../api/admin'
import { trackAdminImageJob } from './adminJobsStore'
import { useAdminConfirm } from './AdminConfirmDialog'

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

const FORM_FIELDS = Object.keys(emptyForm)

// Field-by-field comparison. The previous `JSON.stringify(form) !== JSON.stringify(initial)`
// serialized the entire article body twice on every keystroke.
function isSameForm(left, right) {
  if (left === right) return true
  if (!left || !right) return false
  return FORM_FIELDS.every((key) => left[key] === right[key])
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

function useEditorDarkMode() {
  try {
    return useTheme().dark
  } catch {
    // Keep this leaf component renderable in isolated previews and legacy tests.
    return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  }
}

export default function AdminPostEditor({ editingPost, onBack, onSaved, onDirtyChange }) {
  const confirm = useAdminConfirm()
  const dark = useEditorDarkMode()
  const [editingId, setEditingId] = useState(editingPost?.id || null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [coverMessage, setCoverMessage] = useState('')
  const [coverCandidate, setCoverCandidate] = useState(null)
  const [autoSaveMsg, setAutoSaveMsg] = useState('')
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)
  const [initialForm, setInitialForm] = useState(emptyForm)
  const detailRequestRef = useRef(0)
  const isDirtyRef = useRef(false)

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  useEffect(() => {
    if (editingPost) {
      const controller = new AbortController()
      void loadPostDetail(editingPost, controller.signal)
      return () => controller.abort()
    }
    void restoreDraft()
    return undefined
  }, [editingPost])

  // Keep the latest form in a ref so the autosave interval can read it without
  // being a dependency. Depending on `form` directly would tear down and rebuild
  // the interval on every keystroke, so a user who keeps typing (gaps < 30s) would
  // never actually trigger an autosave — the opposite of the intent.
  const formRef = useRef(form)
  const editingIdRef = useRef(editingId)
  useEffect(() => {
    formRef.current = form
    editingIdRef.current = editingId
  }, [form, editingId])

  const isDirty = useMemo(() => !isSameForm(form, initialForm), [form, initialForm])
  isDirtyRef.current = isDirty

  useEffect(() => {
    onDirtyChange?.(isDirty && !saving)
    return () => onDirtyChange?.(false)
  }, [isDirty, onDirtyChange, saving])

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!isDirty || saving) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, saving])

  useEffect(() => {
    let clearMessageTimer = null
    const timer = setInterval(() => {
      // Only the "new post" flow uses the draft. Editing an existing post must not
      // write admin_draft, or its content would later be offered as a restorable
      // draft on top of an unrelated new post.
      if (editingIdRef.current) return
      localStorage.setItem('admin_draft', JSON.stringify(formRef.current))
      setAutoSaveMsg('已自动保存')
      window.clearTimeout(clearMessageTimer)
      clearMessageTimer = window.setTimeout(() => setAutoSaveMsg(''), 2000)
    }, 30000)
    return () => {
      clearInterval(timer)
      window.clearTimeout(clearMessageTimer)
    }
  }, [])

  async function loadPostDetail(post, signal) {
    // The list refresh upstream hands us a brand-new `editingPost` object whenever the
    // admin post cache expires, which re-runs this loader. Without a request guard the
    // late response would overwrite whatever the user is currently typing — and rewrite
    // the pristine baseline with it, so `isDirty` and the leave prompt both went wrong.
    detailRequestRef.current += 1
    const requestId = detailRequestRef.current
    const isStale = () => requestId !== detailRequestRef.current || signal?.aborted
    const previousEditingId = editingIdRef.current

    setEditingId(post.id)
    setError('')
    setUploadError('')
    setCoverMessage('')
    setCoverCandidate(null)
    try {
      const detail = await fetchPostDetail(post.slug, { signal })
      if (isStale()) return
      const nextForm = {
        title: detail.title,
        slug: detail.slug,
        summary: detail.summary || '',
        content_md: detail.content_md || '',
        tags: (detail.tags || []).map((tag) => tag.slug || tag.name).join(', '),
        cover_image: detail.cover_image || '',
        is_published: detail.is_published !== false,
        is_pinned: detail.is_pinned || false,
      }
      // A refetch of the post we are already editing must never clobber unsaved edits.
      if (isDirtyRef.current && String(previousEditingId) === String(post.id)) {
        setInitialForm(nextForm)
        return
      }
      setInitialForm(nextForm)
      setForm(nextForm)
    } catch (err) {
      if (isStale() || err?.name === 'AbortError') return
      setError('加载文章内容失败')
    }
  }

  async function restoreDraft() {
    setEditingId(null)
    setError('')
    setUploadError('')
    setCoverMessage('')
    setCoverCandidate(null)

    const draft = localStorage.getItem('admin_draft')
    if (!draft) {
      setInitialForm(emptyForm)
      setForm(emptyForm)
      return
    }

    try {
      const parsed = JSON.parse(draft)
      if (parsed.title || parsed.content_md) {
        const shouldRestore = await confirm({
          title: '恢复未保存草稿',
          description: '检测到本机自动保存的文章草稿。恢复后可以继续编辑；选择放弃会清除这份草稿。',
          confirmLabel: '恢复草稿',
          cancelLabel: '放弃草稿',
          tone: 'accent',
        })
        if (shouldRestore) {
          setInitialForm(emptyForm)
          setForm({ ...emptyForm, ...parsed })
        } else {
          setInitialForm(emptyForm)
          setForm(emptyForm)
          localStorage.removeItem('admin_draft')
        }
        return
      }
    } catch {
      // fall through to reset form
    }

    setInitialForm(emptyForm)
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

  async function handleGenerateCover() {
    if (!editingId) return

    const originalCover = form.cover_image || ''
    const hasExistingCover = Boolean(originalCover)
    setCoverGenerating(true)
    setCoverMessage('')
    setCoverCandidate(null)
    setError('')
    try {
      setCoverMessage('封面生成任务已提交，可在右上角「任务」面板查看进度。')
      const result = await trackAdminImageJob({
        label: form.title ? `封面 · ${form.title}` : `文章封面 #${editingId}`,
        detail: hasExistingCover ? '预览重生成' : '首次生成',
        targetType: 'post_cover',
        targetId: editingId,
        submit: () => generateAdminPostCover(editingId, hasExistingCover
          ? { mode: 'preview' }
          : { mode: 'apply', overwrite: false }),
        wait: waitForAdminImageGenerationJob,
      })
      const generatedUrl = result.cover_image || result.result_image_url
      if (result.generated && generatedUrl) {
        if (hasExistingCover) {
          setCoverCandidate({ original: originalCover, candidate: generatedUrl })
          setCoverMessage('已生成候选封面，请选择保留当前封面或使用新封面。')
        } else {
          setForm((prev) => ({ ...prev, cover_image: generatedUrl }))
          setCoverMessage('封面已生成。')
        }
      } else {
        setCoverCandidate(null)
        setCoverMessage(result.error || '封面暂时未生成。')
      }
    } catch (err) {
      setCoverCandidate(null)
      setCoverMessage(err.message || '封面生成失败')
    } finally {
      setCoverGenerating(false)
    }
  }

  async function handleDangerousDirectOverwriteCover() {
    if (!editingId) return
    const confirmed = await confirm({
      title: '直接覆盖文章封面',
      description: `新生成的图片将直接替换“${form.title || `文章 #${editingId}`}”当前封面，不保留候选确认步骤。`,
      confirmLabel: '覆盖并生成',
    })
    if (!confirmed) return

    setCoverGenerating(true)
    setCoverMessage('')
    setCoverCandidate(null)
    setError('')
    try {
      setCoverMessage('封面覆盖任务已提交，可在右上角「任务」面板查看进度。')
      const result = await trackAdminImageJob({
        label: form.title ? `封面覆盖 · ${form.title}` : `文章封面覆盖 #${editingId}`,
        detail: '直接覆盖',
        targetType: 'post_cover',
        targetId: editingId,
        submit: () => generateAdminPostCover(editingId, { mode: 'apply', overwrite: true }),
        wait: waitForAdminImageGenerationJob,
      })
      const generatedUrl = result.cover_image || result.result_image_url
      if (result.generated && generatedUrl) {
        setForm((prev) => ({ ...prev, cover_image: generatedUrl }))
        setCoverMessage('封面已直接覆盖。')
      } else {
        setCoverMessage(result.error || '封面暂时未生成。')
      }
    } catch (err) {
      setCoverMessage(err.message || '封面生成失败')
    } finally {
      setCoverGenerating(false)
    }
  }

  function handleKeepCurrentCover() {
    setForm((prev) => ({ ...prev, cover_image: coverCandidate?.original || prev.cover_image }))
    setCoverCandidate(null)
    setCoverMessage('已保留当前封面。')
  }

  function handleUseCandidateCover() {
    if (!coverCandidate?.candidate) return
    setForm((prev) => ({ ...prev, cover_image: coverCandidate.candidate }))
    setCoverCandidate(null)
    setCoverMessage('已使用新封面，请保存修改后生效。')
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
      setCoverCandidate(null)
      localStorage.removeItem('admin_draft')
      setInitialForm(form)
      onSaved()
    } catch (err) {
      setError(err.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleLeaveEditor() {
    onBack()
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={handleLeaveEditor}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200"
        >
          <ArrowLeft size={16} />
          返回列表
        </button>
        {autoSaveMsg && (
          <span role="status" aria-live="polite" className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs text-[var(--accent)]">
            {autoSaveMsg}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[var(--danger-text)]">
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
            <label htmlFor="admin-post-title" className="text-sm font-medium text-[var(--text-secondary)]">标题</label>
            <input
              id="admin-post-title"
              name="title"
              autoComplete="off"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={inputStyle}
              placeholder="输入文章标题…"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-post-slug" className="text-sm font-medium text-[var(--text-secondary)]">固定链接 Slug</label>
            <div className="flex gap-2">
              <input
                id="admin-post-slug"
                name="slug"
                autoComplete="off"
                spellCheck={false}
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
                className="min-w-0 flex-1 rounded-lg px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
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
          <label htmlFor="admin-post-summary" className="text-sm font-medium text-[var(--text-secondary)]">摘要</label>
          <input
            id="admin-post-summary"
            name="summary"
            autoComplete="off"
            value={form.summary}
            onChange={(event) => setForm({ ...form, summary: event.target.value })}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={inputStyle}
            placeholder="概括文章的核心内容…"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="admin-post-tags" className="text-sm font-medium text-[var(--text-secondary)]">标签，逗号分隔</label>
            <input
              id="admin-post-tags"
              name="tags"
              autoComplete="off"
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
              className="w-full rounded-lg px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={inputStyle}
              placeholder="ai, product, tooling"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="admin-post-cover" className="text-sm font-medium text-[var(--text-secondary)]">封面图 URL</label>
            <input
              id="admin-post-cover"
              name="cover_image"
              type="url"
              autoComplete="url"
              value={form.cover_image}
              onChange={(event) => {
                setCoverCandidate(null)
                setForm({ ...form, cover_image: event.target.value })
              }}
              className="w-full rounded-lg px-4 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              style={inputStyle}
              placeholder="https://... 或留空"
            />
            {form.cover_image ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border-muted)] bg-[var(--bg-canvas)]">
                <div className="flex items-center justify-between gap-3 border-b border-[var(--border-muted)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <span className="font-medium">当前封面预览</span>
                  <a
                    href={form.cover_image}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    打开原图
                  </a>
                </div>
                <img
                  src={proxyImageUrl(form.cover_image)}
                  alt="文章封面预览"
                  className="h-44 w-full object-cover"
                  referrerPolicy="no-referrer"
                  width="1280"
                  height="720"
                />
              </div>
            ) : null}
            {editingId && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleGenerateCover}
                  disabled={coverGenerating}
                  className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
                >
                  {coverGenerating ? '生成中…' : form.cover_image ? '重生成封面' : '生成封面'}
                </button>
                {form.cover_image && (
                  <button
                    type="button"
                    onClick={handleDangerousDirectOverwriteCover}
                    disabled={coverGenerating}
                    className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-200 disabled:opacity-50"
                  >
                    危险：直接覆盖当前封面
                  </button>
                )}
              </div>
            )}
            {coverCandidate && (
              <div className="mt-3 rounded-lg border border-[var(--border-muted)] p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">当前封面</div>
                    <img
                      src={coverCandidate.original}
                      alt="当前封面"
                      className="h-32 w-full rounded-lg object-cover"
                      width="640"
                      height="360"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">生成候选封面</div>
                    <img
                      src={coverCandidate.candidate}
                      alt="生成候选封面"
                      className="h-32 w-full rounded-lg object-cover"
                      width="640"
                      height="360"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleKeepCurrentCover}
                    className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors duration-200"
                  >
                    保留当前封面
                  </button>
                  <button
                    type="button"
                    onClick={handleUseCandidateCover}
                    className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-200"
                  >
                    使用新封面
                  </button>
                </div>
              </div>
            )}
            {coverMessage && (
              <div role="status" aria-live="polite" className="pt-2 text-xs text-[var(--text-secondary)]">{coverMessage}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[var(--text-secondary)]">发布状态：</label>
            <button
              type="button"
              onClick={() => setForm({ ...form, is_published: !form.is_published })}
              aria-pressed={form.is_published}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-[background-color,color,border-color] duration-200"
              style={{
                backgroundColor: form.is_published ? 'var(--accent-soft)' : 'var(--danger-soft)',
                color: form.is_published ? 'var(--accent)' : 'var(--danger-text)',
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
              aria-pressed={form.is_pinned}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-[background-color,color,border-color] duration-200"
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
                name="content_image"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
                aria-label="选择正文图片"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="rounded-lg border border-[var(--border-muted)] px-3 py-1.5 text-sm font-medium text-[var(--accent)] transition-colors duration-200 disabled:opacity-50"
              >
                {uploadingImage ? '上传中…' : '上传正文图片'}
              </button>
            </>
          </div>
          {uploadError && (
            <div role="alert" className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger-text)]">
              {uploadError}
            </div>
          )}
          <div ref={editorRef} data-color-mode={dark ? 'dark' : 'light'}>
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
            type="button"
            disabled={saving}
            className="min-h-11 rounded-lg bg-[var(--accent)] px-6 py-2.5 text-sm font-medium text-white transition-[background-color,opacity,transform] duration-200 disabled:opacity-50"
          >
            {saving ? '保存中…' : editingId ? '保存修改' : form.is_published ? '发布文章' : '保存草稿'}
          </button>
          <button
            type="button"
            onClick={handleLeaveEditor}
            className="rounded-lg border border-[var(--border-muted)] px-6 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
