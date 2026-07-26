import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Clock3,
  Cloud,
  Download,
  Heart,
  History,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react'

import AccountCommandPalette from '../components/account/AccountCommandPalette'
import AccountShell from '../components/account/AccountShell'
import { ConfirmProvider, useConfirm } from '../components/ui/ConfirmDialog'
import { Field, LiveNotice } from '../components/ui/Feedback'
import { useUser } from '../contexts/UserContext'
import {
  changePassword as changePasswordApi,
  clearCloudHistory,
  deleteAccount,
  fetchAccountDashboard,
  fetchAccountExport,
  fetchAccountLibrary,
  removeAccountComment,
  removeAccountLike,
  removeAvatar,
  removeHistoryEntry,
  resendVerification,
  revokeSessions as revokeSessionsApi,
  unfollowTopicCloud,
  updateMe,
  uploadAvatar,
} from '../api/user'
import { proxyImageUrl } from '../utils/proxyImage'
import '../styles/account.css'

const VALID_TABS = new Set(['overview', 'library', 'following', 'profile', 'security'])
const VALID_KINDS = new Set(['all', 'history', 'likes', 'comments'])
const LIBRARY_PAGE_SIZE = 20
const SCROLL_STORAGE_PREFIX = 'signal-account-scroll:v1:'
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
})
const numberFormatter = new Intl.NumberFormat('zh-CN')

function formatDate(value, withTime = false) {
  if (!value) return '暂无记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂无记录'
  return (withTime ? dateTimeFormatter : dateFormatter).format(date)
}

function contentTypeLabel(value) {
  return {
    daily_brief: '每日简报',
    weekly_review: '每周复盘',
    post: '文章',
  }[value] || '文章'
}

function kindLabel(value) {
  return { all: '全部资产', history: '阅读历史', likes: '点赞文章', comments: '我的评论' }[value] || '全部资产'
}

function EmptyState({ icon: Icon = Sparkles, title, description, action }) {
  return (
    <div className="account-empty">
      <Icon size={24} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action || null}
    </div>
  )
}

function SectionHeading({ kicker, title, description, actions }) {
  return (
    <header className="account-section-heading">
      <div>
        <p className="account-kicker">{kicker}</p>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="account-section-heading__actions">{actions}</div> : null}
    </header>
  )
}

function LibraryCover({ item }) {
  // 封面必须走 proxyImageUrl，并在 R2/CDN 抖动或图片被清理时回退到分区图标。
  const coverSrc = proxyImageUrl(item.cover_image)
  const [coverBroken, setCoverBroken] = useState(false)
  const FallbackIcon = item.kind === 'history' ? Clock3 : item.kind === 'likes' ? Heart : MessageSquare

  useEffect(() => {
    setCoverBroken(false)
  }, [coverSrc])

  return (
    <div className="account-library-cover">
      {coverSrc && !coverBroken ? (
        <img
          src={coverSrc}
          alt=""
          width="112"
          height="84"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setCoverBroken(true)}
        />
      ) : (
        <span><FallbackIcon size={22} aria-hidden="true" /></span>
      )}
    </div>
  )
}

function ProfileAvatarPreview({ previewUrl, avatarUrl }) {
  // 本地预览是 blob: URL（proxyImageUrl 会原样返回），远端头像按图片策略解析。
  const avatarSrc = proxyImageUrl(previewUrl || avatarUrl)
  const [avatarBroken, setAvatarBroken] = useState(false)

  useEffect(() => {
    setAvatarBroken(false)
  }, [avatarSrc])

  if (!avatarSrc || avatarBroken) {
    return <UserRound size={38} aria-hidden="true" />
  }

  return (
    <img
      src={avatarSrc}
      alt="头像预览"
      width="112"
      height="112"
      referrerPolicy="no-referrer"
      onError={() => setAvatarBroken(true)}
    />
  )
}

function SectionSkeleton() {
  return (
    <div className="account-skeleton" role="status" aria-label="正在整理你的个人信号…">
      <span />
      <span />
      <span />
    </div>
  )
}

function AccountPageContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const confirm = useConfirm()
  const userContext = useUser()
  const { user, logout, setUser, syncState = 'idle', retrySync } = userContext

  const requestedTab = searchParams.get('tab') || 'overview'
  const activeTab = VALID_TABS.has(requestedTab) ? requestedTab : 'overview'
  const requestedKind = searchParams.get('kind') || 'all'
  const libraryKind = VALID_KINDS.has(requestedKind) ? requestedKind : 'all'
  const libraryQuery = activeTab === 'library' ? (searchParams.get('q') || '').slice(0, 120) : ''
  const rawPage = Number(searchParams.get('page') || 1)
  const libraryPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1

  const [dashboard, setDashboard] = useState({ data: null, loading: true, error: '' })
  const dashboardControllerRef = useRef(null)
  const libraryCacheRef = useRef(new Map())
  const [libraryState, setLibraryState] = useState({ key: '', data: null, loading: false, error: '' })
  const [searchDraft, setSearchDraft] = useState(libraryQuery)
  const [notice, setNotice] = useState({ status: '', error: '' })
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [bio, setBio] = useState(user?.bio || '')
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [securitySaving, setSecuritySaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef(null)
  const mountedRef = useRef(true)
  const leavePromptOpenRef = useRef(false)

  const profileDirty = nickname !== (user?.nickname || '') || bio !== (user?.bio || '') || Boolean(avatarFile)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  // 所有 await 之后的 setState 都要先确认组件仍然挂载，避免卸载后写状态。
  const showNotice = useCallback((next) => {
    if (mountedRef.current) setNotice(next)
  }, [])

  useEffect(() => {
    document.title = '个人信号中心 - AI 资讯观察'
  }, [])

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', activeTab)
    if (activeTab === 'library') {
      next.set('kind', libraryKind)
      if (libraryQuery) next.set('q', libraryQuery)
      else next.delete('q')
      if (libraryPage > 1) next.set('page', String(libraryPage))
      else next.delete('page')
    } else {
      next.delete('kind')
      next.delete('q')
      next.delete('page')
    }
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [activeTab, libraryKind, libraryPage, libraryQuery, searchParams, setSearchParams])

  useEffect(() => {
    setSearchDraft(libraryQuery)
  }, [libraryQuery])

  useEffect(() => {
    setNickname(user?.nickname || '')
    setBio(user?.bio || '')
  }, [user?.bio, user?.nickname])

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
  }, [avatarPreview])

  useEffect(() => {
    if (!profileDirty) return undefined
    function warnBeforeUnload(event) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [profileDirty])

  useEffect(() => {
    if (!profileDirty) return undefined
    let disposed = false

    async function interceptNavigation(event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target.closest?.('a[href]')
      if (!anchor) return
      let target
      try {
        target = new URL(anchor.href, window.location.href)
      } catch {
        return
      }
      if (target.origin !== window.location.origin || `${target.pathname}${target.search}` === `${location.pathname}${location.search}`) return
      // 已经有一个确认框在等待时不要再拦第二次，否则会堆叠对话框。
      if (leavePromptOpenRef.current) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      event.preventDefault()
      event.stopPropagation()

      let approved = false
      leavePromptOpenRef.current = true
      try {
        approved = await confirm({
          title: '离开未保存的资料？',
          description: '昵称、简介或待上传头像尚未保存。离开后这些修改会丢失。',
          confirmLabel: '放弃修改',
        })
      } catch {
        // 部分内嵌 webview 会让确认流程直接抛错；此时放行导航，
        // 绝不能让捕获阶段的拦截把全站链接永久吞掉。
        approved = true
      } finally {
        leavePromptOpenRef.current = false
      }

      if (disposed || !mountedRef.current) return
      if (approved) {
        setAvatarFile(null)
        setNickname(user?.nickname || '')
        setBio(user?.bio || '')
        navigate(`${target.pathname}${target.search}${target.hash}`)
      }
    }

    document.addEventListener('click', interceptNavigation, true)
    return () => {
      disposed = true
      leavePromptOpenRef.current = false
      document.removeEventListener('click', interceptNavigation, true)
    }
  }, [confirm, location.pathname, location.search, navigate, profileDirty, user?.bio, user?.nickname])

  useEffect(() => {
    const storageKey = `${SCROLL_STORAGE_PREFIX}${location.pathname}${location.search}`
    try {
      const saved = Number(window.sessionStorage.getItem(storageKey) || 0)
      const frame = window.requestAnimationFrame(() => {
        if (saved > 0) window.scrollTo({ top: saved, behavior: 'auto' })
      })
      return () => {
        window.cancelAnimationFrame(frame)
        window.sessionStorage.setItem(storageKey, String(window.scrollY || 0))
      }
    } catch {
      return undefined
    }
  }, [location.pathname, location.search])

  const loadDashboard = useCallback(async ({ quiet = false } = {}) => {
    dashboardControllerRef.current?.abort()
    const controller = new AbortController()
    dashboardControllerRef.current = controller
    setDashboard((current) => ({ ...current, loading: quiet ? current.loading : true, error: '' }))
    try {
      const data = await fetchAccountDashboard({ signal: controller.signal })
      if (!mountedRef.current) return
      setDashboard({ data, loading: false, error: '' })
    } catch (error) {
      if (mountedRef.current && error?.name !== 'AbortError') {
        setDashboard((current) => ({ ...current, loading: false, error: String(error?.message || '个人信号暂时无法加载') }))
      }
    }
  }, [])

  useEffect(() => {
    loadDashboard()
    return () => dashboardControllerRef.current?.abort()
  }, [loadDashboard])

  useEffect(() => {
    if (syncState === 'synced') loadDashboard({ quiet: true })
  }, [loadDashboard, syncState])

  const libraryKey = `${libraryKind}|${libraryQuery}|${libraryPage}`
  useEffect(() => {
    if (activeTab !== 'library') return undefined
    const cached = libraryCacheRef.current.get(libraryKey)
    if (cached) {
      setLibraryState({ key: libraryKey, data: cached, loading: false, error: '' })
      return undefined
    }
    const controller = new AbortController()
    setLibraryState({ key: libraryKey, data: null, loading: true, error: '' })
    fetchAccountLibrary({
      kind: libraryKind,
      q: libraryQuery,
      page: libraryPage,
      pageSize: LIBRARY_PAGE_SIZE,
      signal: controller.signal,
    }).then((data) => {
      if (controller.signal.aborted || !mountedRef.current) return
      libraryCacheRef.current.set(libraryKey, data)
      setLibraryState({ key: libraryKey, data, loading: false, error: '' })
    }).catch((error) => {
      if (mountedRef.current && error?.name !== 'AbortError') {
        setLibraryState({ key: libraryKey, data: null, loading: false, error: String(error?.message || '资料库加载失败') })
      }
    })
    return () => controller.abort()
  }, [activeTab, libraryKey, libraryKind, libraryPage, libraryQuery])

  const tabHref = useCallback((tab) => `/account?tab=${tab}`, [])
  const counts = dashboard.data?.counts || { following: 0, history: 0, comments: 0, likes: 0 }

  function libraryHref({ kind = libraryKind, q = libraryQuery, page = 1 } = {}) {
    const params = new URLSearchParams({ tab: 'library', kind })
    if (q) params.set('q', q)
    if (page > 1) params.set('page', String(page))
    return `/account?${params}`
  }

  function submitLibrarySearch(event) {
    event.preventDefault()
    navigate(libraryHref({ q: searchDraft.trim(), page: 1 }))
  }

  async function removeLibraryItem(item) {
    const labels = { history: '移除阅读记录', likes: '取消点赞', comments: '删除评论' }
    const approved = await confirm({
      title: labels[item.kind],
      description: `将“${item.title}”从${kindLabel(item.kind)}中移除。`,
      confirmLabel: labels[item.kind],
    })
    if (!approved) return
    const previous = libraryState.data
    const previousDashboard = dashboard.data
    const next = {
      ...previous,
      total: Math.max(0, previous.total - 1),
      items: previous.items.filter((entry) => !(entry.kind === item.kind && entry.id === item.id)),
    }
    libraryCacheRef.current.clear()
    libraryCacheRef.current.set(libraryKey, next)
    setLibraryState((current) => ({ ...current, data: next }))
    setDashboard((current) => {
      if (!current.data) return current
      const countKey = item.kind
      return {
        ...current,
        data: {
          ...current.data,
          counts: { ...current.data.counts, [countKey]: Math.max(0, current.data.counts[countKey] - 1) },
          recent_history: item.kind === 'history'
            ? current.data.recent_history.filter((entry) => entry.slug !== item.slug)
            : current.data.recent_history,
        },
      }
    })
    try {
      if (item.kind === 'history') await removeHistoryEntry(item.slug)
      else if (item.kind === 'likes') await removeAccountLike(item.slug)
      else await removeAccountComment(item.id)
      if (!mountedRef.current) return
      showNotice({ status: `${labels[item.kind]}成功`, error: '' })
      if (next.items.length === 0 && libraryPage > 1) {
        navigate(libraryHref({ page: libraryPage - 1 }), { replace: true })
      }
    } catch (error) {
      libraryCacheRef.current.set(libraryKey, previous)
      if (!mountedRef.current) return
      setLibraryState((current) => ({ ...current, data: previous }))
      setDashboard({ data: previousDashboard, loading: false, error: '' })
      showNotice({ status: '', error: `${String(error?.message || labels[item.kind])}。列表已恢复，请重试。` })
    }
  }

  async function clearHistory() {
    const approved = await confirm({
      title: '清空阅读历史',
      description: '这会移除全部跨设备阅读记录，且无法恢复。点赞和评论不会受影响。',
      confirmLabel: '清空历史',
    })
    if (!approved) return
    try {
      await clearCloudHistory()
      libraryCacheRef.current.clear()
      if (!mountedRef.current) return
      setDashboard((current) => current.data ? ({
        ...current,
        data: {
          ...current.data,
          counts: { ...current.data.counts, history: 0 },
          recent_history: [],
        },
      }) : current)
      try {
        const refreshed = await fetchAccountLibrary({
          kind: libraryKind,
          q: libraryQuery,
          page: libraryPage,
          pageSize: LIBRARY_PAGE_SIZE,
        })
        if (!mountedRef.current) return
        const lastPage = Math.max(1, Math.ceil(refreshed.total / LIBRARY_PAGE_SIZE))
        if (libraryPage > lastPage) {
          navigate(libraryHref({ page: lastPage }), { replace: true })
        } else {
          libraryCacheRef.current.set(libraryKey, refreshed)
          setLibraryState({ key: libraryKey, data: refreshed, loading: false, error: '' })
        }
        showNotice({ status: '阅读历史已清空', error: '' })
      } catch (refreshError) {
        if (!mountedRef.current) return
        setLibraryState({
          key: libraryKey,
          data: null,
          loading: false,
          error: String(refreshError?.message || '阅读历史已清空，但资料库刷新失败'),
        })
        showNotice({ status: '阅读历史已清空，资料库需要重新加载', error: '' })
      }
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '清空失败，请重试') })
    }
  }

  async function handleUnfollow(topic) {
    const approved = await confirm({
      title: '取消关注主题',
      description: `停止追踪“${topic.display_title || topic.topic_key}”。已产生的阅读记录不会删除。`,
      confirmLabel: '取消关注',
    })
    if (!approved) return
    const previous = dashboard.data
    setDashboard((current) => current.data ? ({
      ...current,
      data: {
        ...current.data,
        counts: { ...current.data.counts, following: Math.max(0, current.data.counts.following - 1) },
        followed_updates: current.data.followed_updates.filter((item) => item.topic_key !== topic.topic_key),
      },
    }) : current)
    try {
      await unfollowTopicCloud(topic.topic_key)
      showNotice({ status: '已取消关注', error: '' })
    } catch (error) {
      if (!mountedRef.current) return
      setDashboard({ data: previous, loading: false, error: '' })
      showNotice({ status: '', error: `${String(error?.message || '取消关注失败')}。主题已恢复。` })
    }
  }

  function chooseAvatar(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setNotice({ status: '', error: '请选择 PNG、JPEG、GIF 或 WebP 图片。' })
      event.target.value = ''
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setNotice({ status: '', error: '头像不能超过 2 MB，请压缩后重试。' })
      event.target.value = ''
      return
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview)
    setAvatarFile(file)
    setAvatarPreview(URL.createObjectURL(file))
    setNotice({ status: '头像已预览，保存后上传', error: '' })
  }

  async function saveProfile(event) {
    event.preventDefault()
    setProfileSaving(true)
    setNotice({ status: '', error: '' })
    try {
      let updated = await updateMe({ nickname, bio })
      if (avatarFile) updated = await uploadAvatar(avatarFile)
      setUser(updated)
      if (avatarPreview) URL.revokeObjectURL(avatarPreview)
      if (!mountedRef.current) return
      setAvatarFile(null)
      setAvatarPreview('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      showNotice({ status: '身份资料已保存', error: '' })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '资料保存失败，请重试') })
    } finally {
      if (mountedRef.current) setProfileSaving(false)
    }
  }

  async function handleRemoveAvatar() {
    const approved = await confirm({
      title: '移除头像',
      description: '评论中的头像也会恢复为默认身份标记。',
      confirmLabel: '移除头像',
    })
    if (!approved) return
    try {
      const updated = await removeAvatar()
      setUser(updated)
      if (!mountedRef.current) return
      setAvatarFile(null)
      setAvatarPreview('')
      showNotice({ status: '头像已移除', error: '' })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '头像移除失败') })
    }
  }

  async function updatePassword(event) {
    event.preventDefault()
    setSecuritySaving(true)
    setNotice({ status: '', error: '' })
    try {
      const updater = userContext.updatePassword || changePasswordApi
      const updated = await updater({ old_password: user?.password_set ? oldPassword : undefined, new_password: newPassword })
      if (updated?.email) setUser(updated)
      if (!mountedRef.current) return
      setOldPassword('')
      setNewPassword('')
      showNotice({ status: user?.password_set ? '密码已更新，旧会话已失效' : '密码已设置', error: '' })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '密码更新失败，请检查后重试') })
    } finally {
      if (mountedRef.current) setSecuritySaving(false)
    }
  }

  async function resendEmailVerification() {
    try {
      await resendVerification()
      showNotice({ status: '验证邮件已发送，请检查收件箱', error: '' })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '发送失败，请稍后重试') })
    }
  }

  const exportData = useCallback(async () => {
    setExporting(true)
    setNotice({ status: '', error: '' })
    try {
      const payload = await fetchAccountExport()
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `signal-desk-data-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      showNotice({ status: '个人数据导出已开始下载', error: '' })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '导出失败，请重试') })
    } finally {
      if (mountedRef.current) setExporting(false)
    }
  }, [showNotice])

  async function revokeAllSessions() {
    const approved = await confirm({
      title: '退出全部设备',
      description: '所有现有登录令牌都会失效，包括当前设备。',
      confirmLabel: '退出全部设备',
    })
    if (!approved) return
    try {
      if (userContext.revokeAllSessions) await userContext.revokeAllSessions()
      else {
        await revokeSessionsApi()
        logout()
      }
      navigate('/login?reason=sessions-revoked', { replace: true })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '操作失败，请稍后重试') })
    }
  }

  async function removeAccount() {
    const approved = await confirm({
      title: '永久注销账号',
      description: '关注、点赞和阅读历史将永久删除；评论会匿名保留。此操作不可恢复。',
      confirmLabel: '永久注销',
      verificationText: '注销账号',
    })
    if (!approved) return
    try {
      await deleteAccount()
      logout()
      navigate('/', { replace: true })
    } catch (error) {
      showNotice({ status: '', error: String(error?.message || '注销失败，请稍后重试') })
    }
  }

  function logoutCurrentDevice() {
    logout()
    navigate('/', { replace: true })
  }

  function renderOverview() {
    if (dashboard.loading && !dashboard.data) return <SectionSkeleton />
    if (dashboard.error && !dashboard.data) {
      return <EmptyState icon={Cloud} title="个人信号暂时离线" description={`${dashboard.error}。请检查网络后重试。`} action={<button type="button" className="account-button" onClick={() => loadDashboard()}><RefreshCw size={16} aria-hidden="true" />重新加载</button>} />
    }
    const recent = dashboard.data?.recent_history || []
    const followed = dashboard.data?.followed_updates || []
    return (
      <div className="account-section-stack">
        <SectionHeading kicker="Today / Resume" title="从最近的信号继续" description="阅读轨迹不是统计终点，而是下一次探索的起点。" />
        {syncState === 'error' ? (
          <div className="account-sync-warning">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>部分本地阅读数据尚未同步到云端。</span>
            <button type="button" onClick={retrySync}>重新同步</button>
          </div>
        ) : null}
        <div className="account-overview-grid">
          <section className="account-resume-panel">
            <div className="account-panel-label"><History size={16} aria-hidden="true" />最近阅读</div>
            {recent.length ? (
              <div className="account-resume-list">
                {recent.slice(0, 4).map((item, index) => (
                  <article key={item.slug}>
                    <span className="account-index">{String(index + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <div className="account-meta"><span>{contentTypeLabel(item.content_type)}</span><time>{formatDate(item.occurred_at)}</time></div>
                      {item.available ? <Link to={`/posts/${item.slug}`} className="line-clamp-2">{item.title}</Link> : <strong className="line-clamp-2">{item.title}</strong>}
                    </div>
                    {item.available ? <Link to={`/posts/${item.slug}`} aria-label={`继续阅读：${item.title}`}><ArrowRight size={18} aria-hidden="true" /></Link> : <span className="account-unavailable">已下线</span>}
                  </article>
                ))}
              </div>
            ) : <EmptyState icon={BookOpen} title="还没有阅读轨迹" description="打开一篇文章，个人信号中心会从这里开始生长。" action={<Link className="account-text-link" to="/discover">探索最新内容</Link>} />}
            {recent.length ? <Link className="account-panel-footer-link" to={libraryHref({ kind: 'history' })}>查看全部阅读历史 <ArrowRight size={15} aria-hidden="true" /></Link> : null}
          </section>

          <aside className="account-ledger" aria-label="个人内容资产摘要">
            <p className="account-panel-label">Content Ledger</p>
            {[
              ['history', '阅读记录', counts.history],
              ['likes', '点赞文章', counts.likes],
              ['comments', '我的评论', counts.comments],
              ['following', '关注主题', counts.following],
            ].map(([kind, label, value]) => (
              <Link key={kind} to={kind === 'following' ? tabHref('following') : libraryHref({ kind })}>
                <span>{label}</span>
                <strong>{numberFormatter.format(value)}</strong>
              </Link>
            ))}
          </aside>
        </div>

        <section className="account-follow-pulse">
          <div className="account-follow-pulse__heading">
            <div><p className="account-panel-label">Following Pulse</p><h3>关注主题的最新文章</h3></div>
            <Link to={tabHref('following')}>管理关注</Link>
          </div>
          {followed.length ? (
            <div className="account-topic-pulse-grid">
              {followed.slice(0, 4).map((topic) => (
                <article key={topic.topic_key}>
                  <Link className="account-topic-chip" to={`/topics/${topic.topic_key}`}>{topic.display_title || topic.topic_key}</Link>
                  {topic.latest_post ? (
                    <>
                      <Link className="line-clamp-2" to={`/posts/${topic.latest_post.slug}`}>{topic.latest_post.title}</Link>
                      <time>{formatDate(topic.latest_post.published_at)}</time>
                    </>
                  ) : <p>这个主题暂时没有新文章。</p>}
                </article>
              ))}
            </div>
          ) : <EmptyState icon={Sparkles} title="还没有关注主题" description="关注主题后，最新文章会在这里形成持续更新的信号流。" action={<Link className="account-text-link" to="/topics">浏览主题</Link>} />}
        </section>

        {!user?.email_verified ? (
          <section className="account-security-callout">
            <AlertTriangle size={21} aria-hidden="true" />
            <div><strong>完成邮箱验证</strong><p>验证后可确保账号恢复和评论身份稳定。</p></div>
            <button type="button" onClick={resendEmailVerification}>发送验证邮件</button>
          </section>
        ) : null}
      </div>
    )
  }

  function renderLibrary() {
    const data = libraryState.data
    const totalPages = data ? Math.max(1, Math.ceil(data.total / LIBRARY_PAGE_SIZE)) : 1
    return (
      <div className="account-section-stack">
        <SectionHeading
          kicker="Library / Personal Knowledge"
          title="我的资料库"
          description="搜索、回看并整理你在 Signal Desk 留下的阅读与互动资产。"
          actions={(libraryKind === 'history' || libraryKind === 'all') && counts.history ? <button type="button" className="account-subtle-button account-subtle-button--danger" onClick={clearHistory}><Trash2 size={15} aria-hidden="true" />清空历史</button> : null}
        />
        <form className="account-library-search" onSubmit={submitLibrarySearch} role="search">
          <Search size={18} aria-hidden="true" />
          <label className="sr-only" htmlFor="account-library-query">搜索个人资料库</label>
          <input id="account-library-query" name="account_library_query" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value.slice(0, 120))} placeholder="搜索标题、摘要或评论内容…" autoComplete="off" />
          {searchDraft ? <button type="button" onClick={() => { setSearchDraft(''); navigate(libraryHref({ q: '', page: 1 })) }} aria-label="清除资料库搜索"><X size={17} aria-hidden="true" /></button> : null}
          <button type="submit">搜索</button>
        </form>
        <nav className="account-library-kinds" aria-label="资料库类型">
          {['all', 'history', 'likes', 'comments'].map((kind) => (
            <Link key={kind} to={libraryHref({ kind, page: 1 })} aria-current={libraryKind === kind ? 'page' : undefined}>
              {kindLabel(kind)}
            </Link>
          ))}
        </nav>
        {libraryState.loading ? <SectionSkeleton /> : null}
        {libraryState.error ? <EmptyState icon={Cloud} title="资料库暂时不可用" description={`${libraryState.error}。切换分区或刷新页面后重试。`} /> : null}
        {!libraryState.loading && !libraryState.error && data ? (
          <>
            <div className="account-library-summary">
              <span>{kindLabel(libraryKind)}</span>
              <strong>{numberFormatter.format(data.total)} 条记录</strong>
            </div>
            {data.items.length ? (
              <div className="account-library-list">
                {data.items.map((item) => (
                  <article key={`${item.kind}-${item.id}`}>
                    <LibraryCover item={item} />
                    <div className="account-library-copy min-w-0">
                      <div className="account-meta"><span>{kindLabel(item.kind)}</span><span>{contentTypeLabel(item.content_type)}</span><time>{formatDate(item.occurred_at, true)}</time></div>
                      {item.available ? <Link className="line-clamp-2" to={`/posts/${item.slug}`}>{item.title}</Link> : <strong className="line-clamp-2">{item.title}</strong>}
                      {item.kind === 'comments' ? <blockquote className="line-clamp-2">{item.comment_content}</blockquote> : item.summary ? <p className="line-clamp-2">{item.summary}</p> : null}
                    </div>
                    <div className="account-library-actions">
                      {item.available ? <Link to={`/posts/${item.slug}`}>阅读全文</Link> : <span>内容不可用</span>}
                      <button type="button" onClick={() => removeLibraryItem(item)} aria-label={`${item.kind === 'likes' ? '取消点赞' : item.kind === 'comments' ? '删除评论' : '移除阅读记录'}：${item.title}`}><Trash2 size={16} aria-hidden="true" /></button>
                    </div>
                  </article>
                ))}
              </div>
            ) : <EmptyState icon={Search} title="没有匹配的内容" description={libraryQuery ? '调整关键词或切换资料类型后重试。' : '你的阅读与互动记录会出现在这里。'} action={libraryQuery ? <Link className="account-text-link" to={libraryHref({ q: '' })}>清除搜索条件</Link> : <Link className="account-text-link" to="/discover">开始探索</Link>} />}
            {totalPages > 1 ? (
              <nav className="account-pagination" aria-label="资料库分页">
                {libraryPage > 1 ? <Link to={libraryHref({ page: libraryPage - 1 })}><ArrowLeft size={16} aria-hidden="true" />上一页</Link> : <span />}
                <span>第 {libraryPage} / {totalPages} 页</span>
                {libraryPage < totalPages ? <Link to={libraryHref({ page: libraryPage + 1 })}>下一页<ArrowRight size={16} aria-hidden="true" /></Link> : <span />}
              </nav>
            ) : null}
          </>
        ) : null}
      </div>
    )
  }

  function renderFollowing() {
    const topics = dashboard.data?.followed_updates || []
    return (
      <div className="account-section-stack">
        <SectionHeading kicker="Following / Topic Radar" title="关注主题" description="查看每个主题的最新公开文章，并随时调整你的追踪范围。" actions={<Link className="account-subtle-button" to="/topics">发现更多主题</Link>} />
        {dashboard.loading && !dashboard.data ? <SectionSkeleton /> : null}
        {topics.length ? (
          <div className="account-following-list">
            {topics.map((topic) => (
              <article key={topic.topic_key}>
                <div className="account-following-orbit" aria-hidden="true"><span /><span /></div>
                <div className="min-w-0">
                  <div className="account-meta"><span>Following</span><time>关注于 {formatDate(topic.followed_at)}</time></div>
                  <Link className="account-following-title" to={`/topics/${topic.topic_key}`}>{topic.display_title || topic.topic_key}</Link>
                  {topic.latest_post ? <Link className="account-following-latest line-clamp-2" to={`/posts/${topic.latest_post.slug}`}>最新：{topic.latest_post.title}</Link> : <p>暂时没有已发布文章。</p>}
                </div>
                <button type="button" onClick={() => handleUnfollow(topic)}>取消关注</button>
              </article>
            ))}
          </div>
        ) : !dashboard.loading ? <EmptyState icon={Sparkles} title="还没有关注主题" description="选择你持续关心的 AI 方向，个人信号中心会自动整理最新文章。" action={<Link className="account-text-link" to="/topics">浏览全部主题</Link>} /> : null}
      </div>
    )
  }

  function renderProfile() {
    return (
      <div className="account-section-stack">
        <SectionHeading kicker="Identity / Profile" title="身份资料" description="昵称和头像会出现在你的公开评论中；邮箱和简介默认保持私有。" />
        <form className="account-profile-form" onSubmit={saveProfile}>
          <section className="account-avatar-editor">
            <div className="account-avatar-editor__preview">
              <ProfileAvatarPreview previewUrl={avatarPreview} avatarUrl={user?.avatar_url} />
            </div>
            <div>
              <h3>个人头像</h3>
              <p>支持 PNG、JPEG、GIF 和 WebP，最大 2 MB。</p>
              <div className="account-avatar-editor__actions">
                <label htmlFor="account-avatar-file"><Upload size={16} aria-hidden="true" />选择图片</label>
                <input ref={fileInputRef} id="account-avatar-file" name="avatar" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={chooseAvatar} />
                {(user?.avatar_url || avatarFile) ? <button type="button" onClick={avatarFile ? () => { setAvatarFile(null); setAvatarPreview(''); if (fileInputRef.current) fileInputRef.current.value = '' } : handleRemoveAvatar}>移除</button> : null}
              </div>
            </div>
          </section>
          <div className="account-form-grid">
            <Field htmlFor="account-nickname" label="昵称" hint={`${nickname.length}/50，将显示在公开评论中`}>
              <input id="account-nickname" name="nickname" value={nickname} onChange={(event) => setNickname(event.target.value.slice(0, 50))} maxLength={50} autoComplete="nickname" required />
            </Field>
            <Field htmlFor="account-email" label="登录邮箱" hint="邮箱仅用于登录、验证与账号恢复">
              <input id="account-email" name="email" type="email" value={user?.email || ''} readOnly autoComplete="email" spellCheck={false} />
            </Field>
            <Field className="account-form-grid__wide" htmlFor="account-bio" label="个人简介" hint={`${bio.length}/300，仅保存在你的账户资料中`}>
              <textarea id="account-bio" name="bio" value={bio} onChange={(event) => setBio(event.target.value.slice(0, 300))} rows={5} maxLength={300} autoComplete="off" placeholder="记录你关注的 AI 方向或阅读目标…" />
            </Field>
          </div>
          <div className="account-form-actions">
            <span>{profileDirty ? '有未保存修改' : '所有修改均已保存'}</span>
            <button type="submit" className="account-button" disabled={!profileDirty || profileSaving}>{profileSaving ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}{profileSaving ? '正在保存…' : '保存身份资料'}</button>
          </div>
        </form>
      </div>
    )
  }

  function renderSecurity() {
    return (
      <div className="account-section-stack">
        <SectionHeading kicker="Security / Data Control" title="账号安全" description="管理验证、密码、跨设备登录和你的个人数据副本。" />
        <div className="account-security-status">
          <article><span className={user?.email_verified ? 'is-ready' : 'is-warning'}>{user?.email_verified ? <BadgeCheck size={20} aria-hidden="true" /> : <AlertTriangle size={20} aria-hidden="true" />}</span><div><strong>邮箱验证</strong><p>{user?.email_verified ? '邮箱已验证，可用于安全恢复。' : '尚未验证，请尽快完成。'}</p></div>{!user?.email_verified ? <button type="button" onClick={resendEmailVerification}>发送验证邮件</button> : null}</article>
          <article><span className="is-ready"><ShieldCheck size={20} aria-hidden="true" /></span><div><strong>登录密码</strong><p>{user?.password_set ? '已设置密码。更新后旧会话会失效。' : '验证码账号尚未设置密码。'}</p></div></article>
          <article><span><Clock3 size={20} aria-hidden="true" /></span><div><strong>最近登录</strong><p>{formatDate(user?.last_login_at, true)}</p></div></article>
        </div>

        <section className="account-security-panel">
          <div><p className="account-panel-label">Password</p><h3>{user?.password_set ? '更新登录密码' : '设置登录密码'}</h3><p>密码至少 8 位。保存后当前令牌会自动替换。</p></div>
          <form onSubmit={updatePassword}>
            {user?.password_set ? <Field htmlFor="account-old-password" label="当前密码"><input id="account-old-password" name="current_password" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" required /></Field> : null}
            <Field htmlFor="account-new-password" label="新密码"><input id="account-new-password" name="new_password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></Field>
            <button type="submit" className="account-button" disabled={securitySaving}>{securitySaving ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}{securitySaving ? '正在更新…' : user?.password_set ? '更新密码' : '设置密码'}</button>
          </form>
        </section>

        <section className="account-data-control">
          <div><p className="account-panel-label">Data Portability</p><h3>下载个人数据副本</h3><p>导出资料、关注主题、阅读历史、点赞和评论为 JSON 文件。</p></div>
          <button type="button" className="account-subtle-button" onClick={exportData} disabled={exporting}>{exporting ? <LoaderCircle className="animate-spin" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}{exporting ? '正在准备…' : '导出我的数据'}</button>
        </section>

        <section className="account-session-control">
          <div><h3>退出全部设备</h3><p>立即撤销所有现有登录令牌，包括当前设备。</p></div>
          <button type="button" className="account-subtle-button" onClick={revokeAllSessions}>退出全部设备</button>
        </section>

        <section className="account-danger-zone">
          <div><p className="account-panel-label">Danger Zone</p><h3>永久注销账号</h3><p>关注、点赞和阅读历史会删除；评论匿名保留。操作不可恢复。</p></div>
          <button type="button" onClick={removeAccount}><Trash2 size={16} aria-hidden="true" />永久注销账号</button>
        </section>
      </div>
    )
  }

  return (
    <AccountShell user={user} activeTab={activeTab} tabHref={tabHref} counts={counts} syncState={syncState} onLogout={logoutCurrentDevice}>
      <div className="account-content-toolbar">
        <LiveNotice status={notice.status} error={notice.error} />
        <AccountCommandPalette tabHref={tabHref} onExport={exportData} />
      </div>
      <div className="account-section-motion" key={activeTab}>
        {activeTab === 'overview' ? renderOverview() : null}
        {activeTab === 'library' ? renderLibrary() : null}
        {activeTab === 'following' ? renderFollowing() : null}
        {activeTab === 'profile' ? renderProfile() : null}
        {activeTab === 'security' ? renderSecurity() : null}
      </div>
    </AccountShell>
  )
}

export default function AccountPage() {
  return <ConfirmProvider><AccountPageContent /></ConfirmProvider>
}
