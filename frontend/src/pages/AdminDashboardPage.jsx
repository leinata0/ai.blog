import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MDEditor from '@uiw/react-md-editor'
import { Pencil, Trash2, Plus, LogOut, ArrowLeft, FileText, Settings, Eye, EyeOff } from 'lucide-react'
import { getToken, clearToken } from '../api/auth'
import { fetchPosts, fetchPostDetail } from '../api/posts'
import { adminCreatePost, adminUpdatePost, adminDeletePost, adminUploadImage, fetchSettings, updateSettings } from '../api/admin'

const emptyForm = { title: '', slug: '', summary: '', content_md: '', tags: '', cover_image: '', is_published: true }

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [tab, setTab] = useState('posts')
  const [posts, setPosts] = useState([])
  const [view, setView] = useState('list')
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const editorRef = useRef(null)
  const fileInputRef = useRef(null)

  const [siteSettings, setSiteSettings] = useState({
    author_name: '', bio: '', avatar_url: '', github_link: '', announcement: '',
  })
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState('')

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return }
    loadPosts()
    loadSettings()
  }, [])

  async function loadPosts() {
    try {
      const result = await fetchPosts({ pageSize: 50 })
      setPosts(result.items)
    } catch { /* ignore */ }
  }

  async function loadSettings() {
    try { setSiteSettings(await fetchSettings()) } catch { /* ignore */ }
  }

  async function handleSaveSettings() {
    setSettingsSaving(true)
    setSettingsMsg('')
    try {
      const updated = await updateSettings(siteSettings)
      setSiteSettings(updated)
      setSettingsMsg('保存成功')
    } catch (err) {
      setSettingsMsg(err.message)
    } finally {
      setSettingsSaving(false)
    }
  }

  function handleLogout() {
    clearToken()
    navigate('/admin/login')
  }

  function handleNew() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setUploadError('')
    setView('editor')
  }

  async function handleEdit(post) {
    setEditingId(post.id)
    setError('')
    setUploadError('')
    setView('editor')
    try {
      const detail = await fetchPostDetail(post.slug)
      setForm({
        title: detail.title,
        slug: detail.slug,
        summary: detail.summary || '',
        content_md: detail.content_md || '',
        tags: (detail.tags || []).map((t) => t.slug || t.name).join(', '),
        cover_image: detail.cover_image || '',
        is_published: detail.is_published !== false,
      })
    } catch {
      setError('加载文章内容失败')
    }
  }

  async function handleDelete(post) {
    if (!window.confirm(`确定删除「${post.title}」？`)) return
    try {
      await adminDeletePost(token, post.id)
      await loadPosts()
    } catch { setError('删除失败') }
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
      tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
    }
    try {
      if (editingId) {
        await adminUpdatePost(token, editingId, data)
      } else {
        await adminCreatePost(token, data)
      }
      await loadPosts()
      setView('list')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
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
      const { url } = await adminUploadImage(token, file)
      insertMarkdownAtCursor(`![image](${url})`)
    } catch (err) {
      setUploadError(err.message)
    } finally {
      event.target.value = ''
      setUploadingImage(false)
    }
  }

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 px-6 sm:px-10"
        style={{ backgroundColor: 'var(--bg-surface)', backdropFilter: 'blur(10px)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between py-4">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--accent)' }}>控制台</h1>
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
            style={{ color: 'var(--text-secondary)' }}>
            <LogOut size={16} /> 退出登录
          </button>
        </div>
        <div className="flex gap-6 -mb-px">
          <button onClick={() => { setTab('posts'); setView('list') }}
            className="flex items-center gap-2 pb-3 text-sm font-medium transition-colors duration-200"
            style={{ color: tab === 'posts' ? 'var(--accent)' : 'var(--text-tertiary)', borderBottom: tab === 'posts' ? '2px solid var(--accent)' : '2px solid transparent' }}>
            <FileText size={15} /> 文章管理
          </button>
          <button onClick={() => setTab('settings')}
            className="flex items-center gap-2 pb-3 text-sm font-medium transition-colors duration-200"
            style={{ color: tab === 'settings' ? 'var(--accent)' : 'var(--text-tertiary)', borderBottom: tab === 'settings' ? '2px solid var(--accent)' : '2px solid transparent' }}>
            <Settings size={15} /> 站点设置
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8">
        {error && (
          <div className="mb-4 text-sm py-2 px-4 rounded-lg" style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {tab === 'posts' && view === 'list' ? (
          <>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>文章管理</h2>
              <button onClick={handleNew}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
                style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                <Plus size={16} /> 发布新文章
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-muted)' }}>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>标题</th>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>状态</th>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>浏览</th>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>日期</th>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>标签</th>
                    <th className="text-right px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.slug} style={{ borderBottom: '1px solid var(--border-muted)' }}>
                      <td className="px-6 py-4 font-medium" style={{ color: 'var(--text-primary)' }}>
                        <div className="flex items-center gap-2">
                          {post.cover_image && (
                            <img src={post.cover_image} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                          )}
                          <span>{post.title}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {post.is_published !== false ? (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
                            <Eye size={12} /> 已发布
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444' }}>
                            <EyeOff size={12} /> 草稿
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4" style={{ color: 'var(--text-tertiary)' }}>{post.view_count || 0}</td>
                      <td className="px-6 py-4" style={{ color: 'var(--text-tertiary)' }}>{formatDate(post.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-1 flex-wrap">
                          {(post.tags || []).map((t) => (
                            <span key={t.slug} className="px-2 py-0.5 rounded text-xs"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>{t.name}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => handleEdit(post)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-gray-100" title="编辑">
                          <Pencil size={15} style={{ color: 'var(--accent)' }} />
                        </button>
                        <button onClick={() => handleDelete(post)} className="p-2 rounded-lg transition-colors duration-200 hover:bg-red-50 ml-1" title="删除">
                          <Trash2 size={15} style={{ color: '#ef4444' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {posts.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-8 text-center" style={{ color: 'var(--text-faint)' }}>暂无文章</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : tab === 'posts' && view === 'editor' ? (
          <div>
            <button onClick={() => setView('list')}
              className="flex items-center gap-2 mb-6 text-sm font-medium transition-colors duration-200"
              style={{ color: 'var(--text-secondary)' }}>
              <ArrowLeft size={16} /> 返回列表
            </button>

            <div className="rounded-xl p-6 sm:p-8 space-y-5"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editingId ? '编辑文章' : '发布新文章'}
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>标题</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="文章标题" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Slug</label>
                  <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="url-friendly-slug" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>摘要</label>
                <input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="简短描述" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>标签（逗号分隔）</label>
                  <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="python, devops" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>封面图 URL</label>
                  <input value={form.cover_image} onChange={(e) => setForm({ ...form, cover_image: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="https://... 或留空" />
                </div>
              </div>

              {/* 发布状态 */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>发布状态：</label>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_published: !form.is_published })}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    backgroundColor: form.is_published ? 'var(--accent-soft)' : 'var(--danger-soft)',
                    color: form.is_published ? 'var(--accent)' : '#ef4444',
                    border: `1px solid ${form.is_published ? 'var(--accent-border)' : 'var(--danger-border)'}`,
                  }}
                >
                  {form.is_published ? <><Eye size={14} /> 公开发布</> : <><EyeOff size={14} /> 保存为草稿</>}
                </button>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>内容（Markdown）</label>
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
                      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-200 disabled:opacity-50"
                      style={{ color: 'var(--accent)', border: '1px solid var(--border-muted)' }}
                    >
                      {uploadingImage ? '上传中...' : '上传图片'}
                    </button>
                  </>
                </div>
                {uploadError && (
                  <div className="text-sm py-2 px-3 rounded-lg" style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444' }}>
                    {uploadError}
                  </div>
                )}
                <div ref={editorRef} data-color-mode="light">
                  <MDEditor value={form.content_md} onChange={(v) => setForm({ ...form, content_md: v || '' })} height={400} />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSave} disabled={saving}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                  {saving ? '保存中...' : editingId ? '保存修改' : form.is_published ? '发布文章' : '保存草稿'}
                </button>
                <button onClick={() => setView('list')}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-muted)' }}>
                  取消
                </button>
              </div>
            </div>
          </div>
        ) : tab === 'settings' ? (
          <div className="rounded-xl p-6 sm:p-8 space-y-5"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>站点设置</h2>

            {settingsMsg && (
              <div className="text-sm py-2 px-4 rounded-lg"
                style={{ backgroundColor: settingsMsg === '保存成功' ? 'var(--accent-soft)' : 'var(--danger-soft)', color: settingsMsg === '保存成功' ? 'var(--accent)' : '#ef4444' }}>
                {settingsMsg}
              </div>
            )}

            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>博主名称</label>
              <input value={siteSettings.author_name} onChange={(e) => setSiteSettings({ ...siteSettings, author_name: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>个人简介</label>
              <input value={siteSettings.bio} onChange={(e) => setSiteSettings({ ...siteSettings, bio: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>头像 URL</label>
              <input value={siteSettings.avatar_url} onChange={(e) => setSiteSettings({ ...siteSettings, avatar_url: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="https://..." />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>GitHub 链接</label>
              <input value={siteSettings.github_link} onChange={(e) => setSiteSettings({ ...siteSettings, github_link: e.target.value })}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>公告内容</label>
              <textarea value={siteSettings.announcement} onChange={(e) => setSiteSettings({ ...siteSettings, announcement: e.target.value })}
                rows={3} className="w-full px-4 py-2.5 rounded-lg text-sm outline-none resize-none" style={inputStyle} />
            </div>

            <button onClick={handleSaveSettings} disabled={settingsSaving}
              className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
              {settingsSaving ? '保存中...' : '保存设置'}
            </button>
          </div>
        ) : null}
      </div>
    </main>
  )
}
