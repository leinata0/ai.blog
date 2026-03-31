import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MDEditor from '@uiw/react-md-editor'
import { Pencil, Trash2, Plus, LogOut, ArrowLeft } from 'lucide-react'
import { getToken, clearToken } from '../api/auth'
import { fetchPosts } from '../api/posts'
import { adminCreatePost, adminUpdatePost, adminDeletePost } from '../api/admin'

const emptyForm = { title: '', slug: '', summary: '', content_md: '', tags: '' }

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [posts, setPosts] = useState([])
  const [view, setView] = useState('list') // 'list' | 'editor'
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return }
    loadPosts()
  }, [])

  async function loadPosts() {
    try { setPosts(await fetchPosts()) } catch { /* ignore */ }
  }

  function handleLogout() {
    clearToken()
    navigate('/admin/login')
  }

  function handleNew() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setView('editor')
  }

  function handleEdit(post) {
    setEditingId(post.id)
    setForm({
      title: post.title,
      slug: post.slug,
      summary: post.summary || '',
      content_md: post.content_md || '',
      tags: (post.tags || []).map((t) => t.slug || t.name).join(', '),
    })
    setError('')
    setView('editor')
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

  const inputStyle = {
    backgroundColor: 'var(--bg-canvas)',
    border: '1px solid var(--border-muted)',
    color: 'var(--text-primary)',
  }
  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10 py-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.87)', backdropFilter: 'blur(10px)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--accent)' }}>控制台</h1>
        <button onClick={handleLogout}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200"
          style={{ color: 'var(--text-secondary)' }}>
          <LogOut size={16} /> 退出登录
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8">
        {error && (
          <div className="mb-4 text-sm py-2 px-4 rounded-lg" style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        {view === 'list' ? (
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
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>Slug</th>
                    <th className="text-left px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>标签</th>
                    <th className="text-right px-6 py-3 font-medium" style={{ color: 'var(--text-faint)' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => (
                    <tr key={post.slug} style={{ borderBottom: '1px solid var(--border-muted)' }}>
                      <td className="px-6 py-4 font-medium" style={{ color: 'var(--text-primary)' }}>{post.title}</td>
                      <td className="px-6 py-4" style={{ color: 'var(--text-tertiary)' }}>{post.slug}</td>
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
                    <tr><td colSpan={4} className="px-6 py-8 text-center" style={{ color: 'var(--text-faint)' }}>暂无文章</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
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

              <div className="space-y-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>标签（逗号分隔）</label>
                <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-lg text-sm outline-none" style={inputStyle} placeholder="python, devops" />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>内容（Markdown）</label>
                <div data-color-mode="light">
                  <MDEditor value={form.content_md} onChange={(v) => setForm({ ...form, content_md: v || '' })} height={400} />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSave} disabled={saving}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)', color: '#fff' }}>
                  {saving ? '保存中...' : editingId ? '保存修改' : '发布文章'}
                </button>
                <button onClick={() => setView('list')}
                  className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors duration-200"
                  style={{ color: 'var(--text-secondary)', border: '1px solid var(--border-muted)' }}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
