import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ActivitySquare,
  BarChart3,
  FileText,
  HeartPulse,
  Image,
  LogOut,
  MessageSquare,
  Radio,
  Settings,
} from 'lucide-react'

import { clearToken, getToken } from '../api/auth'
import { adminDeletePost, adminUpdatePost, fetchAdminPosts } from '../api/admin'
import AdminComments from '../components/admin/AdminComments'
import AdminContentHealth from '../components/admin/AdminContentHealth'
import AdminImages from '../components/admin/AdminImages'
import AdminPostEditor from '../components/admin/AdminPostEditor'
import AdminPostsList from '../components/admin/AdminPostsList'
import AdminPublishingStatus from '../components/admin/AdminPublishingStatus'
import AdminSeriesManager from '../components/admin/AdminSeriesManager'
import AdminSettings from '../components/admin/AdminSettings'
import AdminStats from '../components/admin/AdminStats'

const defaultPostFilters = {
  search: '',
  content_type: '',
  published: '',
  published_mode: '',
  coverage_date: '',
  series_slug: '',
}

function normalizePostFilters(filters) {
  const params = { page_size: 50 }
  if (filters.search?.trim()) params.q = filters.search.trim()
  if (filters.content_type) params.content_type = filters.content_type
  if (filters.published === 'published') params.is_published = 'true'
  if (filters.published === 'draft') params.is_published = 'false'
  if (filters.published_mode) params.published_mode = filters.published_mode
  if (filters.coverage_date) params.coverage_date = filters.coverage_date
  if (filters.series_slug?.trim()) params.series_slug = filters.series_slug.trim()
  return params
}

function getBulkPatchPayload(action, value) {
  if (action === 'publish') return { is_published: true }
  if (action === 'unpublish') return { is_published: false }
  if (action === 'pin') return { is_pinned: true }
  if (action === 'unpin') return { is_pinned: false }
  if (action === 'set_content_type') return { content_type: value || undefined }
  if (action === 'set_series') return { series_slug: value || null }
  return null
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const token = getToken()

  const [tab, setTab] = useState('posts')
  const [view, setView] = useState('list')
  const [posts, setPosts] = useState([])
  const [editingPost, setEditingPost] = useState(null)
  const [error, setError] = useState('')
  const [postFilters, setPostFilters] = useState(defaultPostFilters)
  const [postLoading, setPostLoading] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)

  useEffect(() => {
    if (!token) {
      navigate('/admin/login')
      return
    }
    loadPosts(defaultPostFilters)
  }, [])

  async function loadPosts(nextFilters = postFilters) {
    setPostLoading(true)
    try {
      const params = normalizePostFilters(nextFilters)
      const result = await fetchAdminPosts(params)
      setPosts(result.items || result || [])
      setError('')
    } catch (err) {
      setError(err.message || 'Failed to load posts')
    } finally {
      setPostLoading(false)
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
    if (!window.confirm(`Delete "${post.title}"?`)) return
    try {
      await adminDeletePost(post.id)
      await loadPosts()
    } catch (err) {
      setError(err.message || 'Failed to delete post')
    }
  }

  function handlePostSaved() {
    loadPosts()
    setView('list')
  }

  async function handleBulkAction({ action, postIds, value }) {
    const patch = getBulkPatchPayload(action, value)
    if (!patch) return
    setBulkApplying(true)
    try {
      await Promise.all(postIds.map((id) => adminUpdatePost(id, patch)))
      await loadPosts()
      setError('')
    } catch (err) {
      setError(err.message || 'Bulk action failed')
    } finally {
      setBulkApplying(false)
    }
  }

  function handleApplyFilters(nextFilters) {
    setPostFilters(nextFilters)
    loadPosts(nextFilters)
  }

  function handleResetFilters(nextFilters) {
    setPostFilters(nextFilters)
    loadPosts(nextFilters)
  }

  const tabItems = [
    { key: 'posts', label: 'Posts', icon: FileText },
    { key: 'publishing', label: 'Publishing', icon: Radio },
    { key: 'health', label: 'Content Health', icon: HeartPulse },
    { key: 'series', label: 'Series', icon: ActivitySquare },
    { key: 'comments', label: 'Comments', icon: MessageSquare },
    { key: 'settings', label: 'Settings', icon: Settings },
    { key: 'stats', label: 'Stats', icon: BarChart3 },
    { key: 'images', label: 'Images', icon: Image },
  ]

  return (
    <main className="min-h-screen bg-[var(--bg-canvas)]">
      <header
        className="sticky top-0 z-50 bg-[var(--bg-surface)] px-6 sm:px-10"
        style={{ backdropFilter: 'blur(10px)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      >
        <div className="flex items-center justify-between py-4">
          <h1 className="text-xl font-semibold text-[var(--accent)]">Editorial Operations Console</h1>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
        <div className="-mb-px flex gap-6 overflow-x-auto">
          {tabItems.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                if (key === 'posts') setView('list')
              }}
              className="flex items-center gap-2 whitespace-nowrap pb-3 text-sm font-medium transition-colors duration-200"
              style={{
                color: tab === key ? 'var(--accent)' : 'var(--text-tertiary)',
                borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-10">
        {error ? (
          <div className="mb-4 rounded-lg bg-[var(--danger-soft)] px-4 py-2 text-sm text-[#ef4444]">{error}</div>
        ) : null}

        {tab === 'posts' && view === 'list' ? (
          <AdminPostsList
            posts={posts}
            filters={postFilters}
            loading={postLoading}
            bulkApplying={bulkApplying}
            onNew={handleNew}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRefresh={() => loadPosts()}
            onApplyFilters={handleApplyFilters}
            onResetFilters={handleResetFilters}
            onRunBulkAction={handleBulkAction}
          />
        ) : null}
        {tab === 'posts' && view === 'editor' ? (
          <AdminPostEditor editingPost={editingPost} onBack={() => setView('list')} onSaved={handlePostSaved} />
        ) : null}
        {tab === 'publishing' ? <AdminPublishingStatus /> : null}
        {tab === 'health' ? <AdminContentHealth /> : null}
        {tab === 'series' ? <AdminSeriesManager /> : null}
        {tab === 'comments' ? <AdminComments /> : null}
        {tab === 'settings' ? <AdminSettings /> : null}
        {tab === 'stats' ? <AdminStats /> : null}
        {tab === 'images' ? <AdminImages /> : null}
      </div>
    </main>
  )
}
