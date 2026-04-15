import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ActivitySquare,
  BarChart3,
  FileText,
  HeartPulse,
  Image,
  Inbox,
  LogOut,
  MessagesSquare,
  MessageSquare,
  Radio,
  Search,
  Settings,
  Shapes,
  Waypoints,
} from 'lucide-react'

import { clearToken, getToken } from '../api/auth'
import { adminDeletePost, adminUpdatePost, fetchAdminPosts } from '../api/admin'
import AdminComments from '../components/admin/AdminComments'
import AdminContentHealth from '../components/admin/AdminContentHealth'
import AdminImages from '../components/admin/AdminImages'
import AdminPostEditor from '../components/admin/AdminPostEditor'
import AdminPostsList from '../components/admin/AdminPostsList'
import AdminPublishingStatus from '../components/admin/AdminPublishingStatus'
import AdminQualityInbox from '../components/admin/AdminQualityInbox'
import AdminSearchInsights from '../components/admin/AdminSearchInsights'
import AdminSeriesManager from '../components/admin/AdminSeriesManager'
import AdminSettings from '../components/admin/AdminSettings'
import AdminStats from '../components/admin/AdminStats'
import AdminTopicFeedback from '../components/admin/AdminTopicFeedback'
import AdminTopicHealth from '../components/admin/AdminTopicHealth'
import AdminTopicProfiles from '../components/admin/AdminTopicProfiles'

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
      setError(err.message || '加载文章列表失败')
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
    if (!window.confirm(`确定删除《${post.title}》吗？`)) return
    try {
      await adminDeletePost(post.id)
      await loadPosts()
    } catch (err) {
      setError(err.message || '删除文章失败')
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
      setError(err.message || '批量操作失败')
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
    { key: 'posts', label: '文章管理', icon: FileText },
    { key: 'publishing', label: '发布状态', icon: Radio },
    { key: 'health', label: '内容健康', icon: HeartPulse },
    { key: 'quality', label: '质量收件箱', icon: Inbox },
    { key: 'topic-feedback', label: '主题反馈', icon: MessagesSquare },
    { key: 'topics', label: '主题管理', icon: Shapes },
    { key: 'topic-health', label: '主题健康', icon: Waypoints },
    { key: 'search-insights', label: '搜索洞察', icon: Search },
    { key: 'series', label: '系列管理', icon: ActivitySquare },
    { key: 'comments', label: '评论管理', icon: MessageSquare },
    { key: 'settings', label: '站点设置', icon: Settings },
    { key: 'stats', label: '统计面板', icon: BarChart3 },
    { key: 'images', label: '图片管理', icon: Image },
  ]

  return (
    <main className="min-h-screen bg-[var(--bg-canvas)]">
      <header
        className="sticky top-0 z-50 bg-[var(--bg-surface)] px-6 sm:px-10"
        style={{ backdropFilter: 'blur(10px)', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      >
        <div className="flex items-center justify-between py-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--accent)]">博客编辑运营台</h1>
            <p className="mt-1 text-sm text-[var(--text-faint)]">统一管理文章、系列、主题、质量与发布状态。</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
          >
            <LogOut size={16} />
            退出登录
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
        {tab === 'quality' ? <AdminQualityInbox /> : null}
        {tab === 'topic-feedback' ? <AdminTopicFeedback /> : null}
        {tab === 'topics' ? <AdminTopicProfiles /> : null}
        {tab === 'topic-health' ? <AdminTopicHealth /> : null}
        {tab === 'search-insights' ? <AdminSearchInsights /> : null}
        {tab === 'series' ? <AdminSeriesManager /> : null}
        {tab === 'comments' ? <AdminComments /> : null}
        {tab === 'settings' ? <AdminSettings /> : null}
        {tab === 'stats' ? <AdminStats /> : null}
        {tab === 'images' ? <AdminImages /> : null}
      </div>
    </main>
  )
}
