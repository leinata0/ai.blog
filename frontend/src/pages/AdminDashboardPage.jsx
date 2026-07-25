import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ActivitySquare,
  BarChart3,
  FileText,
  Globe2,
  HeartPulse,
  Image as ImageIcon,
  Inbox,
  MessagesSquare,
  MessageSquare,
  Radio,
  Search,
  Settings,
  Shapes,
  Waypoints,
} from 'lucide-react'

import { clearToken, getToken } from '../api/auth'
import {
  adminDeletePost,
  adminUpdatePost,
  fetchAdminPost,
  fetchAdminPosts,
  generateAdminPostCover,
} from '../api/admin'
import AdminPostsList from '../components/admin/AdminPostsList'
import AdminShell from '../components/admin/AdminShell'
import { AdminConfirmProvider, useAdminConfirm } from '../components/admin/AdminConfirmDialog'
import { AdminLiveNotice } from '../components/admin/adminUi'
import { upsertAdminJob } from '../components/admin/adminJobsStore'
import '../styles/operations.css'

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

const ADMIN_GROUPS = [
  {
    label: '内容',
    items: [
      { key: 'posts', label: '文章', icon: FileText },
      { key: 'topics', label: '主题', icon: Shapes },
      { key: 'series', label: '系列', icon: ActivitySquare },
      { key: 'comments', label: '评论', icon: MessageSquare },
      { key: 'images', label: '图片', icon: ImageIcon },
    ],
  },
  {
    label: '智能',
    items: [
      { key: 'quality', label: '质量收件箱', icon: Inbox },
      { key: 'topic-feedback', label: '主题反馈', icon: MessagesSquare },
      { key: 'search-insights', label: '搜索洞察', icon: Search },
      { key: 'health', label: '内容健康', icon: HeartPulse },
      { key: 'topic-health', label: '主题健康', icon: Waypoints },
    ],
  },
  {
    label: '运行',
    items: [
      { key: 'publishing', label: '发布状态', icon: Radio },
      { key: 'endpoint-health', label: '接口与订阅', icon: Globe2 },
      { key: 'stats', label: '统计', icon: BarChart3 },
    ],
  },
  {
    label: '系统',
    items: [
      { key: 'settings', label: '系统设置', icon: Settings },
    ],
  },
]

const SECTION_META = {
  posts: ['文章工作台', '筛选、编辑与发布内容，批量任务保持在当前工作上下文。'],
  topics: ['主题管理', '维护主题身份、别名与首页重点信号。'],
  series: ['系列管理', '组织长期叙事线索与系列封面。'],
  comments: ['评论管理', '审核读者反馈并维护讨论质量。'],
  images: ['图片管理', '检查媒体资源、引用关系与存储状态。'],
  quality: ['质量收件箱', '集中处理内容质量信号与人工复核。'],
  'topic-feedback': ['主题反馈', '观察关注、反馈与内容需求信号。'],
  'search-insights': ['搜索洞察', '发现高频查询与零结果内容缺口。'],
  health: ['内容健康', '识别内容陈旧、缺图和结构完整性问题。'],
  'topic-health': ['主题健康', '衡量主题覆盖密度、来源和质量。'],
  publishing: ['发布状态', '跟踪自动与人工发布流水线。'],
  'endpoint-health': ['接口与订阅健康', '核对公开接口和订阅渠道的实时状态。'],
  stats: ['运营统计', '查看现有数据范围内的内容与访问概况。'],
  settings: ['系统设置', '管理站点展示、Provider、模型与运行计划。'],
}

const VALID_SECTIONS = new Set(ADMIN_GROUPS.flatMap((group) => group.items.map((item) => item.key)))
const VALID_CONTENT_TYPES = new Set(['', 'daily_brief', 'weekly_review', 'post'])
const VALID_PUBLISHED = new Set(['', 'published', 'draft'])
const VALID_PUBLISHED_MODES = new Set(['', 'auto', 'manual'])
const VALID_PANELS = new Set(['site', 'providers', 'models', 'runtime'])
const VALID_PAGE_SIZES = new Set([20, 50])
const BULK_COVER_SUBMIT_TIMEOUT_MS = 12000
const BULK_COVER_SUBMIT_CONCURRENCY = 4

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function readPostFilters(searchParams) {
  return {
    search: searchParams.get('q') || '',
    content_type: searchParams.get('content_type') || '',
    published: searchParams.get('published') || '',
    published_mode: searchParams.get('published_mode') || '',
    coverage_date: searchParams.get('coverage_date') || '',
    series_slug: searchParams.get('series_slug') || '',
  }
}

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

function writePostFilters(params, filters) {
  const mappings = [
    ['q', filters.search?.trim()],
    ['content_type', filters.content_type],
    ['published', filters.published],
    ['published_mode', filters.published_mode],
    ['coverage_date', filters.coverage_date],
    ['series_slug', filters.series_slug?.trim()],
  ]
  mappings.forEach(([key, value]) => {
    if (value) params.set(key, value)
    else params.delete(key)
  })
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
    <div className="ops-panel ops-loader" role="status">
      正在加载管理面板…
    </div>
  )
}

function AdminDashboardContent() {
  const confirm = useAdminConfirm()
  const navigate = useNavigate()
  const token = getToken()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchKey = searchParams.toString()

  const requestedSection = searchParams.get('section') || 'posts'
  const section = VALID_SECTIONS.has(requestedSection) ? requestedSection : 'posts'
  const requestedView = searchParams.get('view') || 'list'
  const view = section === 'posts' && requestedView === 'editor' ? 'editor' : 'list'
  const postParam = view === 'editor' ? searchParams.get('post') : null
  const panel = VALID_PANELS.has(searchParams.get('panel')) ? searchParams.get('panel') : 'site'
  const page = positiveInteger(searchParams.get('page'), 1)
  const requestedPageSize = positiveInteger(searchParams.get('page_size'), defaultPostPagination.pageSize)
  const pageSize = VALID_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : defaultPostPagination.pageSize
  const postFilters = useMemo(() => readPostFilters(searchParams), [searchKey])

  const [posts, setPosts] = useState([])
  const [editingPost, setEditingPost] = useState(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [postPagination, setPostPagination] = useState(defaultPostPagination)
  const [postLoading, setPostLoading] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)

  const updateQuery = useCallback((mutate, options = {}) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      mutate(next)
      return next
    }, options)
  }, [setSearchParams])

  useEffect(() => {
    if (!token) {
      navigate('/admin/login', { replace: true })
    }
  }, [navigate, token])

  useEffect(() => {
    document.title = `${SECTION_META[section][0]} · Signal Desk Operations`
  }, [section])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    const clean = (key) => {
      if (next.has(key)) {
        next.delete(key)
        changed = true
      }
    }

    if (!VALID_SECTIONS.has(requestedSection)) {
      next.set('section', 'posts')
      changed = true
    }
    if (section !== 'posts') {
      clean('view')
      clean('post')
      ;['q', 'content_type', 'published', 'published_mode', 'coverage_date', 'series_slug', 'page', 'page_size']
        .forEach(clean)
    } else {
      if (!['list', 'editor'].includes(requestedView)) {
        clean('view')
      }
      if (view === 'editor' && postParam !== 'new' && !/^\d+$/.test(postParam || '')) {
        next.set('view', 'list')
        clean('post')
        changed = true
      }
      if (view === 'list') clean('post')
      if (!VALID_CONTENT_TYPES.has(postFilters.content_type)) clean('content_type')
      if (!VALID_PUBLISHED.has(postFilters.published)) clean('published')
      if (!VALID_PUBLISHED_MODES.has(postFilters.published_mode)) clean('published_mode')
      if (searchParams.has('page') && String(page) !== searchParams.get('page')) {
        if (page === 1) clean('page')
        else {
          next.set('page', String(page))
          changed = true
        }
      }
      if (searchParams.has('page_size') && !VALID_PAGE_SIZES.has(requestedPageSize)) clean('page_size')
    }
    if (section !== 'settings') clean('panel')
    else if (searchParams.has('panel') && !VALID_PANELS.has(searchParams.get('panel'))) clean('panel')

    if (changed) setSearchParams(next, { replace: true })
  }, [
    page,
    postFilters.content_type,
    postFilters.published,
    postFilters.published_mode,
    postParam,
    requestedPageSize,
    requestedSection,
    requestedView,
    searchKey,
    searchParams,
    section,
    setSearchParams,
    view,
  ])

  const loadPosts = useCallback(async (
    nextFilters = postFilters,
    requestOptions = {},
    paginationOptions = {},
  ) => {
    setPostLoading(true)
    try {
      const nextPage = paginationOptions.page ?? page
      const nextPageSize = paginationOptions.pageSize ?? pageSize
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
      return items
    } catch (err) {
      setError(err.message || '加载文章列表失败')
      return []
    } finally {
      setPostLoading(false)
    }
  }, [page, pageSize, postFilters])

  useEffect(() => {
    if (!token || section !== 'posts') return
    void loadPosts(postFilters, {}, { page, pageSize })
  }, [loadPosts, page, pageSize, postFilters, searchKey, section, token])

  useEffect(() => {
    if (view !== 'editor' || !postParam) {
      setEditorLoading(false)
      return undefined
    }
    if (postParam === 'new') {
      setEditingPost(null)
      setEditorLoading(false)
      return undefined
    }

    const matchingPost = posts.find((post) => String(post.id) === postParam)
    if (matchingPost) {
      setEditingPost(matchingPost)
      setEditorLoading(false)
      return undefined
    }

    const controller = new AbortController()
    let active = true
    setEditingPost(null)
    setEditorLoading(true)
    setError('')

    void fetchAdminPost(postParam, { signal: controller.signal })
      .then((post) => {
        if (active) setEditingPost(post)
      })
      .catch((loadError) => {
        if (!active || controller.signal.aborted) return
        const message = String(loadError?.message || '')
        if (/post not found|http 404/i.test(message)) {
          setStatus('未找到要编辑的文章，已返回文章列表。')
          updateQuery((next) => {
            next.delete('view')
            next.delete('post')
          }, { replace: true })
          return
        }
        setError(loadError?.message || '加载文章失败，请稍后重试。')
      })
      .finally(() => {
        if (active) setEditorLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [postParam, posts, updateQuery, view])

  const confirmEditorExit = useCallback(async () => {
    if (view !== 'editor' || !editorDirty) return true
    return confirm({
      title: '放弃尚未保存的修改？',
      description: '离开文章编辑器会丢失本次尚未保存的标题、正文、封面和发布状态修改。',
      confirmLabel: '放弃并离开',
      cancelLabel: '继续编辑',
      tone: 'danger',
    })
  }, [confirm, editorDirty, view])

  async function handleLogout() {
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    clearToken()
    navigate('/admin/login', { replace: true })
  }

  async function handleReturnPublic() {
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    navigate('/')
  }

  async function handleSectionChange(nextSection) {
    if (nextSection === section && view === 'list') return
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    setError('')
    setStatus('')
    updateQuery((next) => {
      next.set('section', nextSection)
      ;['view', 'post', 'panel', 'q', 'content_type', 'published', 'published_mode', 'coverage_date', 'series_slug', 'page', 'page_size']
        .forEach((key) => next.delete(key))
      if (nextSection === 'settings') next.set('panel', 'site')
    })
  }

  async function handleNew() {
    if (view === 'editor' && postParam === 'new') return
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    setEditingPost(null)
    setError('')
    updateQuery((next) => {
      next.set('section', 'posts')
      next.set('view', 'editor')
      next.set('post', 'new')
    })
  }

  async function handleEdit(post) {
    if (view === 'editor' && String(post.id) === postParam) return
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    setEditingPost(post)
    setError('')
    updateQuery((next) => {
      next.set('section', 'posts')
      next.set('view', 'editor')
      next.set('post', String(post.id))
    })
  }

  function returnToList() {
    updateQuery((next) => {
      next.delete('view')
      next.delete('post')
    })
  }

  async function handleBackToList() {
    if (!await confirmEditorExit()) return
    setEditorDirty(false)
    returnToList()
  }

  async function handleDelete(post) {
    const confirmed = await confirm({
      title: '删除文章',
      description: `将永久删除《${post.title}》及其管理记录。此操作不可撤销。`,
      confirmLabel: '删除文章',
    })
    if (!confirmed) return
    try {
      await adminDeletePost(post.id)
      const remainingTotal = Math.max(0, postPagination.total - 1)
      const maxPage = Math.max(1, Math.ceil(remainingTotal / postPagination.pageSize))
      const targetPage = Math.min(postPagination.page, maxPage)
      if (targetPage !== page) {
        updateQuery((next) => {
          if (targetPage === 1) next.delete('page')
          else next.set('page', String(targetPage))
        })
      } else {
        await loadPosts(postFilters, {}, { page: targetPage })
      }
    } catch (err) {
      setError(err.message || '删除文章失败')
    }
  }

  function handlePostSaved() {
    setEditorDirty(false)
    void loadPosts(postFilters, {}, { page })
    returnToList()
  }

  async function handleBulkAction({ action, postIds, value, skippedCount = 0 }) {
    setBulkApplying(true)
    setStatus('')
    try {
      if (action === 'generate_missing_covers' || action === 'replace_covers') {
        const isReplace = action === 'replace_covers'
        const submissions = []
        const actionLabel = isReplace ? '封面替换' : '封面生成'
        setStatus(`正在提交 0 / ${postIds.length} 篇文章的${actionLabel}任务…`)
        await runWithConcurrency(postIds, isReplace ? 1 : BULK_COVER_SUBMIT_CONCURRENCY, async (id) => {
          const post = posts.find((item) => item.id === id)
          const label = post?.title ? `封面 · ${post.title}` : `文章封面 #${id}`
          try {
            const result = await generateAdminPostCover(
              id,
              { mode: 'apply', overwrite: isReplace },
              { timeout: BULK_COVER_SUBMIT_TIMEOUT_MS },
            )
            const jobId = result?.job_id || result?.id || null
            upsertAdminJob({
              jobId,
              label,
              detail: isReplace ? '批量替换封面' : '批量生成封面',
              targetType: 'post_cover',
              targetId: id,
              status: result?.maybe_running ? 'timeout' : (jobId ? 'running' : 'queued'),
              error: result?.error || '',
            })
            submissions.push({ id, result })
          } catch (err) {
            upsertAdminJob({
              label,
              detail: isReplace ? '批量替换封面' : '批量生成封面',
              targetType: 'post_cover',
              targetId: id,
              status: 'failed',
              error: err?.message || '提交失败',
            })
            submissions.push({ id, error: err })
          } finally {
            setStatus(`正在提交 ${submissions.length} / ${postIds.length} 篇文章的${actionLabel}任务…`)
          }
        })
        const submittedCount = submissions.filter(({ result }) => result?.job_id || result?.id).length
        const maybeRunningCount = submissions.filter(({ result }) => result?.maybe_running).length
        const failedSubmissions = submissions.filter(({ error: submissionError }) => submissionError)
        const failedCount = failedSubmissions.length
        const countedSubmitted = submittedCount + maybeRunningCount
        const errorMessages = Array.from(new Set(
          failedSubmissions.map(({ error: submissionError }) => String(submissionError?.message || '提交失败')).filter(Boolean),
        ))
        await loadPosts(postFilters, {}, { page })
        if (failedCount === submissions.length) {
          const detail = errorMessages[0] ? `：${errorMessages[0]}` : '，请稍后重试。'
          setError(`批量${actionLabel}提交失败${detail}`)
          setStatus(errorMessages.length > 1 ? `其它错误：${errorMessages.slice(1, 3).join('；')}` : '')
          return
        }
        setError('')
        const parts = [
          isReplace
            ? `已提交 ${countedSubmitted} 篇文章的封面替换任务`
            : `已提交 ${countedSubmitted} 篇无封面文章的封面生成任务`,
        ]
        if (skippedCount) parts.push(`跳过 ${skippedCount} 篇已有封面的文章`)
        if (maybeRunningCount) parts.push(`${maybeRunningCount} 个请求响应较慢但可能仍在后台执行`)
        if (failedCount) parts.push(`${failedCount} 篇提交失败：${errorMessages.slice(0, 2).join('；')}`)
        setStatus(`${parts.join('，')}。任务会在后台依次处理，可在右上角「任务」面板查看进度。`)
        return
      }

      const patch = getBulkPatchPayload(action, value)
      if (!patch) return
      await Promise.all(postIds.map((id) => adminUpdatePost(id, patch)))
      await loadPosts(postFilters, {}, { page })
      setError('')
    } catch (err) {
      setError(err.message || '批量操作失败')
    } finally {
      setBulkApplying(false)
    }
  }

  function handleApplyFilters(nextFilters) {
    updateQuery((next) => {
      writePostFilters(next, nextFilters)
      next.delete('page')
    })
  }

  function handleResetFilters(nextFilters) {
    handleApplyFilters(nextFilters)
  }

  function handlePageChange(nextPage) {
    updateQuery((next) => {
      if (nextPage === 1) next.delete('page')
      else next.set('page', String(nextPage))
    })
  }

  function handlePageSizeChange(nextPageSize) {
    updateQuery((next) => {
      next.delete('page')
      if (nextPageSize === defaultPostPagination.pageSize) next.delete('page_size')
      else next.set('page_size', String(nextPageSize))
    })
  }

  const [title, description] = SECTION_META[section]
  const editorReady = postParam === 'new'
    || (!editorLoading && String(editingPost?.id || '') === postParam)

  return (
    <AdminShell
      groups={ADMIN_GROUPS}
      activeSection={section}
      onSectionChange={handleSectionChange}
      onCreatePost={handleNew}
      onOpenPost={handleEdit}
      onReturnPublic={handleReturnPublic}
      onLogout={handleLogout}
      title={title}
      description={description}
    >
      <AdminLiveNotice error={error} status={status} />

      <Suspense fallback={<AdminPanelLoader />}>
        {section === 'posts' && view === 'list' ? (
          <AdminPostsList
            posts={posts}
            filters={postFilters}
            pagination={postPagination}
            loading={postLoading}
            bulkApplying={bulkApplying}
            onNew={handleNew}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRefresh={() => loadPosts(postFilters, { forceRefresh: true }, { page })}
            onApplyFilters={handleApplyFilters}
            onResetFilters={handleResetFilters}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            onRunBulkAction={handleBulkAction}
          />
        ) : null}
        {section === 'posts' && view === 'editor' && editorReady ? (
          <AdminPostEditor
            editingPost={editingPost}
            onBack={handleBackToList}
            onSaved={handlePostSaved}
            onDirtyChange={setEditorDirty}
          />
        ) : null}
        {section === 'posts' && view === 'editor' && !editorReady ? <AdminPanelLoader /> : null}
        {section === 'publishing' ? <AdminPublishingStatus /> : null}
        {section === 'health' ? <AdminContentHealth /> : null}
        {section === 'endpoint-health' ? <AdminEndpointHealth /> : null}
        {section === 'quality' ? <AdminQualityInbox /> : null}
        {section === 'topic-feedback' ? <AdminTopicFeedback /> : null}
        {section === 'topics' ? <AdminTopicProfiles /> : null}
        {section === 'topic-health' ? <AdminTopicHealth /> : null}
        {section === 'search-insights' ? <AdminSearchInsights /> : null}
        {section === 'series' ? <AdminSeriesManager /> : null}
        {section === 'comments' ? <AdminComments /> : null}
        {section === 'settings' ? (
          <AdminSettings
            panel={panel}
            onPanelChange={(nextPanel) => updateQuery((next) => next.set('panel', nextPanel))}
          />
        ) : null}
        {section === 'stats' ? <AdminStats /> : null}
        {section === 'images' ? <AdminImages /> : null}
      </Suspense>
    </AdminShell>
  )
}

export default function AdminDashboardPage() {
  return (
    <AdminConfirmProvider>
      <AdminDashboardContent />
    </AdminConfirmProvider>
  )
}
