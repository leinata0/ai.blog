import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Settings, LogOut, MessageSquare, BarChart3, Image } from 'lucide-react'
import { getToken, clearToken } from '../api/auth'
import { fetchAdminPosts, adminDeletePost } from '../api/admin'
import AdminPostsList from '../components/admin/AdminPostsList'
import AdminPostEditor from '../components/admin/AdminPostEditor'
import AdminComments from '../components/admin/AdminComments'
import AdminSettings from '../components/admin/AdminSettings'
import AdminStats from '../components/admin/AdminStats'
import AdminImages from '../components/admin/AdminImages'

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [tab, setTab] = useState('posts')
  const [view, setView] = useState('list')
  const [posts, setPosts] = useState([])
  const [editingPost, setEditingPost] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return }
    loadPosts()
  }, [])

  async function loadPosts() {
    try {
      const result = await fetchAdminPosts({ page_size: 50 })
      setPosts(result.items || result || [])
    } catch (err) {
      setError(err.message || '加载文章失败')
    }
  }

  function handleLogout() {
    clearToken()
    navigate('/admin/login')
  }

  function handleNew() {
    setEditingPost(null)
    setError('')
    setView('editor')
  }

  function handleEdit(post) {
    setEditingPost(post)
    setError('')
    setView('editor')
  }
  async function handleDelete(post) {
    if (!window.confirm(`确定删除「${post.title}」？`)) return
    try {
      await adminDeletePost(post.id)
      await loadPosts()
    } catch (err) {
      setError(err.message || '删除失败')
    }
  }

  function handlePostSaved() {
    loadPosts()
    setView('list')
  }

  const tabItems = [
    { key: 'posts', label: '文章管理', icon: FileText },
    { key: 'comments', label: '评论管理', icon: MessageSquare },
    { key: 'settings', label: '站点设置', icon: Settings },
    { key: 'stats', label: '数据统计', icon: BarChart3 },
    { key: 'images', label: '图片管理', icon: Image },
  ]

  return (
    <main className="min-h-screen bg-[var(--bg-canvas)]">
      <header className="sticky top-0 z-50 px-6 sm:px-10 bg-[var(--bg-surface)]"
        style={{ backdropFilter: 'blur(10px)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between py-4">
          <h1 className="text-xl font-semibold text-[var(--accent)]">控制台</h1>
          <button onClick={handleLogout}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-200 text-[var(--text-secondary)]">
            <LogOut size={16} /> 退出登录
          </button>
        </div>
        <div className="flex gap-6 -mb-px overflow-x-auto">
          {tabItems.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => { setTab(key); if (key === 'posts') setView('list') }}
              className="flex items-center gap-2 pb-3 text-sm font-medium transition-colors duration-200 whitespace-nowrap"
              style={{ color: tab === key ? 'var(--accent)' : 'var(--text-tertiary)', borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent' }}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8">
        {error && (
          <div className="mb-4 text-sm py-2 px-4 rounded-lg bg-[var(--danger-soft)] text-[#ef4444]">{error}</div>
        )}

        {tab === 'posts' && view === 'list' && (
          <AdminPostsList posts={posts} onNew={handleNew} onEdit={handleEdit} onDelete={handleDelete} />
        )}
        {tab === 'posts' && view === 'editor' && (
          <AdminPostEditor editingPost={editingPost} onBack={() => setView('list')} onSaved={handlePostSaved} />
        )}
        {tab === 'comments' && <AdminComments />}
        {tab === 'settings' && <AdminSettings />}
        {tab === 'stats' && <AdminStats />}
        {tab === 'images' && <AdminImages />}
      </div>
    </main>
  )
}
