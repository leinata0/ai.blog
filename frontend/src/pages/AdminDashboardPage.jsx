import { Suspense, lazy, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ActivitySquare,
  BarChart3,
  FileText,
  Globe2,
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
import { adminDeletePost, adminUpdatePost, fetchAdminPosts, generateAdminPostCover } from '../api/admin'
import AdminPostsList from '../components/admin/AdminPostsList'

const AdminComments = lazy(() => import('../components/admin/AdminComments'))
const AdminContentHealth = lazy(() => import('../components/admin/AdminContentHealth'))
const AdminEndpointHealth = lazy(() => import('../components/admin/AdminEndpointHealth'))
const AdminImages = lazy(() => import('../components/admin/AdminImages'))
const AdminPostEditor = lazy(() => import('../components/admin/AdminPostEditor'))
const AdminPublishingStatus = lazy(() => import('../components/admin/AdminPublishingStatus'))
const AdminQualityInbox = lazy(() => import('../components/admin/AdminQualityInbox'))
const AdminSearchInsights = lazy(() => import('../components/admin/AdminSearchInsights'))
const AdminSeriesManager = lazy(() => import('../components/admin/AdminSeriesManager'))
const AdminSettings = lazy(() => import('../components/admin/AdminSettings'))
const AdminStats = lazy(() => import('../components/admin/AdminStats'))
const AdminTopicFeedback = lazy(() => import('../components/admin/AdminTopicFeedback'))
const AdminTopicHealth = lazy(() => import('../components/admin/AdminTopicHealth'))
const AdminTopicProfiles = lazy(() => import('../components/admin/AdminTopicProfiles'))

const defaultPostFilters = {
  search: '',
  content_type: '',
  published: '',
  published_mode: '',
  coverage_date: '',
  series_slug: '',
}

const defaultPostPagination = {
  total: 0,
  page: 1,
  pageSize: 20,
}
const BULK_COVER_SUBMIT_TIMEOUT_MS = 12000
const BULK_COVER_SUBMIT_CONCURRENCY = 4

function normalizePostFilters(filters, { page = 1, pageSize = 20 } = {}) {
  const params = { page, page_size: pageSize }
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

async function runWithConcurrency(items, limit, task) {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()
      await task(item)
    }
  })
  await Promise.all(workers)
}

function AdminPanelLoader() {
  return (
    <div className="rounded-2xl border border-[var(--border-muted)] bg-[var(--bg-surface)] px-5 py-6 text-sm text-[var(--text-faint)]">
      正在加载管理面板...
    </div>
  )
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const token = getToken()

  const [tab, setTab] = useState('posts')
  const [view, setView] = useState('list')
  const [posts, setPosts] = useState([])
  const [editingPost, setEditingPost] = useState(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [postFilters, setPostFilters] = useState(defaultPostFilters)
  const [postPagination, setPostPagination] = useState(defaultPostPagination)
  const [postLoading, setPostLoading] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)

  useEffect(() => {
    if (!token) {
      navigate('/admin/login')
      return
    }
    loadPosts(defaultPostFilters, {}, { page: 1, pageSize: defaultPostPagination.pageSize })
  }, [])

  async function loadPosts(nextFilters = postFilters, requestOptions = {}, paginationOptions = {}) {
    setPostLoading(true)
    try {
      const nextPage = paginationOptions.page ?? postPagination.page ?? defaultPostPagination.page
      const nextPageSize = paginationOptions.pageSize ?? postPagination.pageSize ?? defaultPostPagination.pageSize
      const params = normalizePostFilters(nextFilters, { page: nextPage, pageSize: nextPageSize })
      const result = await fetchAdminPosts(params, requestOptions)
      const items = result.items || result || []
      setPosts(items)
      setPostPagination({
        total: Number(result.total ?? items.length),
        page: Number(result.page ?? nextPage),
        pageSize: Number(result.page_size ?? nextPageSize),
      })
      setError('')
      setStatus('')
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
      const remainingTotal = Math.max(0, postPagination.total - 1)
      const maxPage = Math.max(1, Math.ceil(remainingTotal / postPagination.pageSize))
      await loadPosts(postFilters, {}, { page: Math.min(postPagination.page, maxPage) })
    } catch (err) {
      setError(err.message || '删除文章失败')
    }
  }

  function handlePostSaved() {
    loadPosts(postFilters, {}, { page: postPagination.page })
    setView('list')
  }

  async function handleBulkAction({ action, postIds, value, skippedCount = 0 }) {
    setBulkApplying(true)
    setStatus('')
    try {
      if (action === 'generate_missing_covers') {
        const submissions = []
        setStatus(`正在提交 0 / ${postIds.length} 篇文章的封面生成任务...`)
        await runWithConcurrency(postIds, BULK_COVER_SUBMIT_CONCURRENCY, async (id) => {
          try {
            const result = await generateAdminPostCover(
              id,
              { mode: 'apply', overwrite: false },
              { timeout: BULK_COVER_SUBMIT_TIMEOUT_MS }
            )
            submissions.push({ id, result })
          } catch (err) {
            submissions.push({ id, error: err })
          } finally {
            setStatus(`正在提交 ${submissions.length} / ${postIds.length} 篇文章的封面生成任务...`)
          }
        })
        const submittedCount = submissions.filter(({ result }) => result?.job_id || result?.id).length
        const maybeRunningCount = submissions.filter(({ result }) => result?.maybe_running).length
        const failedSubmissions = submissions.filter(({ error }) => error)
        const failedCount = failedSubmissions.length
        const countedSubmitted = submittedCount + maybeRunningCount
        const errorMessages = Array.from(new Set(
          failedSubmissions
            .map(({ error }) => String(error?.message || '提交失败'))
            .filter(Boolean)
        ))
        await loadPosts(postFilters, {}, { page: postPagination.page })
        if (failedCount === submissions.length) {
          const detail = errorMessages[0] ? `：${errorMessages[0]}` : '，请稍后重试。'
          setError(`批量封面生成提交失败${detail}`)
          setStatus(errorMessages.length > 1 ? `其它错误：${errorMessages.slice(1, 3).join('；')}` : '')
          return
        }
        setError('')
        const parts = [`已提交 ${countedSubmitted} 篇无封面文章的封面生成任务`]
        if (skippedCount) parts.push(`跳过 ${skippedCount} 篇已有封面的文章`)
        if (maybeRunningCount) parts.push(`${maybeRunningCount} 个请求响应较慢但可能仍在后台执行`)
        if (failedCount) parts.push(`${failedCount} 篇提交失败：${errorMessages.slice(0, 2).join('；')}`)
        setStatus(`${parts.join('，')}。任务会在后台依次处理，请稍后刷新查看结果。`)
        return
      }

      const patch = getBulkPatchPayload(action, value)
      if (!patch) return
      await Promise.all(postIds.map((id) => adminUpdatePost(id, patch)))
      await loadPosts(postFilters, {}, { page: postPagination.page })
      setError('')
    } catch (err) {
      setError(err.message || '批量操作失败')
    } finally {
      setBulkApplying(false)
    }
  }

  function handleApplyFilters(nextFilters) {
    setPostFilters(nextFilters)
    loadPosts(nextFilters, {}, { page: 1 })
  }

  function handleResetFilters(nextFilters) {
    setPostFilters(nextFilters)
    loadPosts(nextFilters, {}, { page: 1 })
  }

  function handlePageChange(page) {
    loadPosts(postFilters, {}, { page })
  }

  function handlePageSizeChange(pageSize) {
    loadPosts(postFilters, {}, { page: 1, pageSize })
  }

  const tabItems = [
    { key: 'posts', label: '文章管理', icon: FileText },
    { key: 'publishing', label: '发布状态', icon: Radio },
    { key: 'health', label: '内容健康', icon: HeartPulse },
    { key: 'endpoint-health', label: '接口与订阅健康', icon: Globe2 },
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
        {status ? (
          <div className="mb-4 rounded-lg border border-[var(--border-muted)] bg-[var(--bg-surface)] px-4 py-2 text-sm text-[var(--text-secondary)]">{status}</div>
        ) : null}

        <Suspense fallback={<AdminPanelLoader />}>
          {tab === 'posts' && view === 'list' ? (
            <AdminPostsList
              posts={posts}
              filters={postFilters}
              pagination={postPagination}
              loading={postLoading}
              bulkApplying={bulkApplying}
              onNew={handleNew}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRefresh={() => loadPosts(postFilters, { forceRefresh: true }, { page: postPagination.page })}
              onApplyFilters={handleApplyFilters}
              onResetFilters={handleResetFilters}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
              onRunBulkAction={handleBulkAction}
            />
          ) : null}
          {tab === 'posts' && view === 'editor' ? (
            <AdminPostEditor editingPost={editingPost} onBack={() => setView('list')} onSaved={handlePostSaved} />
          ) : null}
          {tab === 'publishing' ? <AdminPublishingStatus /> : null}
          {tab === 'health' ? <AdminContentHealth /> : null}
          {tab === 'endpoint-health' ? <AdminEndpointHealth /> : null}
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
        </Suspense>
      </div>
    </main>
  )
}
