import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  BellRing,
  Filter,
  Mail,
  Newspaper,
  RadioTower,
  Rss,
  Sparkles,
  Tags,
} from 'lucide-react'

import { fetchSeriesList, fetchTopics } from '../api/posts'
import {
  fetchSubscriptionStatus,
  subscribeEmail,
  fetchWebPushPublicKey,
  subscribeWebPush,
  unsubscribeWebPush,
} from '../api/subscriptions'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import { getSeriesTitle, getTopicTitle, motionContainerVariants, motionItemVariants } from '../utils/contentPresentation'
import { urlBase64ToUint8Array } from '../utils/webPush'

const CORE_FEEDS = [
  {
    key: 'site',
    title: '全站更新',
    description: '适合想把整站内容都放进 RSS 阅读器的人，一次接住日报、周报、主题延伸与专题文章。',
    href: buildPublicApiUrl('/feed.xml'),
    eyebrow: '全站 RSS',
  },
  {
    key: 'daily',
    title: 'AI 日报',
    description: '只收每天最值得跟进的变化，适合高频关注新的模型、产品与行业信号。',
    href: buildPublicApiUrl('/api/feeds/daily.xml'),
    eyebrow: '日报 RSS',
  },
  {
    key: 'weekly',
    title: 'AI 周报',
    description: '只收每周整理后的回看主线，适合低频但希望信息结构完整的读者。',
    href: buildPublicApiUrl('/api/feeds/weekly.xml'),
    eyebrow: '周报 RSS',
  },
]

const CONTENT_TYPE_OPTIONS = [
  { value: '', label: '全站更新', description: '同时接收全站内容' },
  { value: 'daily_brief', label: '只收 AI 日报', description: '更关注每天的新变化' },
  { value: 'weekly_review', label: '只收 AI 周报', description: '更关注每周回看' },
]

function buildScopeSummary({ contentType, topic, series }) {
  const parts = []
  if (!contentType) {
    parts.push('全站更新')
  } else if (contentType === 'daily_brief') {
    parts.push('AI 日报')
  } else if (contentType === 'weekly_review') {
    parts.push('AI 周报')
  }
  if (topic) parts.push(`主题：${getTopicTitle(topic)}`)
  if (series) parts.push(`系列：${getSeriesTitle(series)}`)
  return parts.join(' / ')
}

function FeedCard({ eyebrow, title, description, href, linkText = '打开订阅地址', extraLink }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-6 py-6"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="section-kicker">{eyebrow}</div>
      <h3 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        {description}
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
        >
          <Rss size={15} />
          {linkText}
        </a>
        {extraLink}
      </div>
    </motion.article>
  )
}

function TaxonomyFeedCard({ item, type }) {
  const title = type === 'topic' ? getTopicTitle(item) : getSeriesTitle(item)
  const description =
    item.description
    || (type === 'topic'
      ? '适合只追踪这条内容主线后续发生了什么。'
      : '适合沿着同一个栏目路径持续接收更新。')
  const href = type === 'topic'
    ? buildPublicApiUrl(`/api/feeds/topics/${encodeURIComponent(item.topic_key)}.xml`)
    : buildPublicApiUrl(`/api/feeds/series/${encodeURIComponent(item.slug)}.xml`)
  const detailTo = type === 'topic' ? `/topics/${item.topic_key}` : `/series/${item.slug}`

  return (
    <FeedCard
      eyebrow={type === 'topic' ? '主题 RSS' : '系列 RSS'}
      title={title}
      description={description}
      href={href}
      linkText={type === 'topic' ? '订阅这个主题' : '订阅这个系列'}
      extraLink={(
        <Link
          to={detailTo}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
          style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
        >
          查看详情
          <ArrowUpRight size={14} />
        </Link>
      )}
    />
  )
}

function ScopePicker({ contentType, onContentTypeChange, topicKey, onTopicKeyChange, seriesSlug, onSeriesSlugChange, topics, seriesList }) {
  return (
    <motion.section variants={motionItemVariants} className="editorial-panel rounded-[2rem] px-8 py-8">
      <EditorialSectionHeader
        eyebrow="订阅范围"
        title="把订阅粒度收紧到你真正关心的更新"
        description="你可以只收全站、只收日报或周报，也可以进一步叠加单个主题或单个系列，把订阅变成更明确的阅读收益。"
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>内容粒度</span>
          <select
            value={contentType}
            onChange={(event) => onContentTypeChange(event.target.value)}
            className="mt-2 w-full rounded-[1.25rem] border px-4 py-3 text-sm outline-none"
            style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
          >
            {CONTENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>主题追踪</span>
          <select
            value={topicKey}
            onChange={(event) => onTopicKeyChange(event.target.value)}
            className="mt-2 w-full rounded-[1.25rem] border px-4 py-3 text-sm outline-none"
            style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
          >
            <option value="">不限定主题</option>
            {topics.map((topic) => (
              <option key={topic.topic_key} value={topic.topic_key}>
                {getTopicTitle(topic)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>系列阅读</span>
          <select
            value={seriesSlug}
            onChange={(event) => onSeriesSlugChange(event.target.value)}
            className="mt-2 w-full rounded-[1.25rem] border px-4 py-3 text-sm outline-none"
            style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
          >
            <option value="">不限定系列</option>
            {seriesList.map((series) => (
              <option key={series.slug} value={series.slug}>
                {getSeriesTitle(series)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </motion.section>
  )
}

function ScopeSummaryCard({ contentType, topic, series }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="rounded-[1.6rem] border px-5 py-5"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="section-kicker">当前范围</div>
      <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
        <Filter size={13} />
        {buildScopeSummary({ contentType, topic, series })}
      </div>
      <p className="mt-4 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        {topic || series
          ? '你已经把范围收窄到了更具体的主线，后面的邮件与浏览器提醒会沿这组偏好保存。'
          : '当前是较宽的阅读入口，适合先建立整体回访机制，后续再收紧到主题或系列。'}
      </p>
    </motion.article>
  )
}

function ChannelStatusBadge({ enabled, readyText, pendingText }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
      style={{
        backgroundColor: enabled ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
        color: enabled ? '#047857' : '#B45309',
      }}
    >
      {enabled ? readyText : pendingText}
    </span>
  )
}

function EmailSubscriptionCard({ status, contentType, topicKey, seriesSlug }) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const result = await subscribeEmail({
        email,
        content_types: contentType ? [contentType] : ['all'],
        topic_keys: topicKey ? [topicKey] : [],
        series_slugs: seriesSlug ? [seriesSlug] : [],
      })
      setMessage(result.message || '邮件订阅已保存。')
      setEmail('')
    } catch (err) {
      setError(err.message || '保存邮件订阅时失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-6 py-6"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="section-kicker">邮件订阅</div>
          <h3 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            让你关心的更新直接进邮箱
          </h3>
        </div>
        <ChannelStatusBadge enabled={Boolean(status?.email_configured)} readyText="已接入" pendingText="待配置" />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        适合想在收件箱里稳定回看内容的人。你保存的范围会决定后续收到的是全站、日报、周报，还是更具体的主题与系列更新。
      </p>

      <form onSubmit={handleSubmit} className="mt-5">
        <label className="block text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
          邮箱地址
        </label>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          className="mt-2 w-full rounded-[1.2rem] border px-4 py-3 text-sm outline-none"
          style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !email.trim()}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <Mail size={15} />
            {saving ? '保存中...' : '保存邮件订阅'}
          </button>
          {!status?.email_configured ? (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              站点还没有完成邮件投递配置，先保存偏好也没问题，后续接通后会开始发送。
            </span>
          ) : null}
        </div>

        {message ? (
          <div className="mt-4 rounded-[1.1rem] px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#047857' }}>
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-[1.1rem] px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#b91c1c' }}>
            {error}
          </div>
        ) : null}
      </form>
    </motion.article>
  )
}

function BrowserPushCard({ status, contentType, topicKey, seriesSlug }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'default',
  )

  const pushSupported = typeof window !== 'undefined'
    && window.isSecureContext
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window

  useEffect(() => {
    if (!pushSupported) return undefined

    let cancelled = false

    async function syncState() {
      try {
        const registration = await navigator.serviceWorker.register('/push-sw.js')
        const subscription = await registration.pushManager.getSubscription()
        if (!cancelled) {
          setSubscribed(Boolean(subscription))
          setPermission(window.Notification.permission)
        }
      } catch {
        if (!cancelled) setSubscribed(false)
      }
    }

    syncState()
    return () => {
      cancelled = true
    }
  }, [pushSupported])

  async function handleEnable() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (!pushSupported) {
        throw new Error('当前浏览器或环境不支持 Web Push，请换到 HTTPS 下的桌面浏览器。')
      }
      if (!status?.web_push_configured) {
        throw new Error('站点还没有完成浏览器通知配置，请稍后再试。')
      }

      const permissionResult = await window.Notification.requestPermission()
      setPermission(permissionResult)
      if (permissionResult !== 'granted') {
        throw new Error('浏览器没有授予通知权限，无法启用提醒。')
      }

      const { public_key: publicKey } = await fetchWebPushPublicKey()
      const registration = await navigator.serviceWorker.register('/push-sw.js')
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        })
      }

      const json = subscription.toJSON()
      const result = await subscribeWebPush({
        endpoint: json.endpoint,
        keys: json.keys,
        content_types: contentType ? [contentType] : ['all'],
        topic_keys: topicKey ? [topicKey] : [],
        series_slugs: seriesSlug ? [seriesSlug] : [],
      })
      setSubscribed(true)
      setMessage(result.message || '浏览器提醒已启用。')
    } catch (err) {
      setError(err.message || '启用浏览器提醒时失败。')
    } finally {
      setBusy(false)
    }
  }

  async function handleDisable() {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      if (!pushSupported) {
        throw new Error('当前浏览器不支持关闭 Web Push 状态同步。')
      }
      const registration = await navigator.serviceWorker.getRegistration()
      const subscription = registration ? await registration.pushManager.getSubscription() : null
      if (subscription) {
        await unsubscribeWebPush({ endpoint: subscription.endpoint })
        await subscription.unsubscribe()
      }
      setSubscribed(false)
      setMessage('这个浏览器的提醒已关闭。')
    } catch (err) {
      setError(err.message || '关闭浏览器提醒时失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-6 py-6"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="section-kicker">浏览器提醒</div>
          <h3 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            在当前设备直接收到新通知
          </h3>
        </div>
        <ChannelStatusBadge enabled={Boolean(status?.web_push_configured)} readyText="已接入" pendingText="待配置" />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        适合想第一时间看到新变化的人。它更像轻提醒，打开后你就能继续回到刚才正在追踪的主题或系列。
      </p>

      <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        <span>浏览器状态：{pushSupported ? '支持 Web Push' : '当前环境不支持'}</span>
        <span>通知权限：{permission === 'granted' ? '已允许' : permission === 'denied' ? '已拒绝' : '待选择'}</span>
        <span>当前设备：{subscribed ? '已订阅' : '未订阅'}</span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {!subscribed ? (
          <button
            type="button"
            disabled={busy || !pushSupported}
            onClick={handleEnable}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            <BellRing size={15} />
            {busy ? '启用中...' : '启用浏览器提醒'}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={handleDisable}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
          >
            <BellRing size={15} />
            {busy ? '处理中...' : '关闭浏览器提醒'}
          </button>
        )}
      </div>

      {message ? (
        <div className="mt-4 rounded-[1.1rem] px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(16,185,129,0.12)', color: '#047857' }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="mt-4 rounded-[1.1rem] px-4 py-3 text-sm" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#b91c1c' }}>
          {error}
        </div>
      ) : null}
    </motion.article>
  )
}

function WecomSubscriptionCard({ status }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-6 py-6"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="section-kicker">企业微信机器人</div>
          <h3 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            适合把更新同步给团队
          </h3>
        </div>
        <ChannelStatusBadge enabled={Boolean(status?.wecom_configured)} readyText="已接入" pendingText="待配置" />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        这个通道更适合站长或团队内部使用。配置企业微信机器人后，新的文章摘要会自动同步到群里。
      </p>

      <div className="mt-5 rounded-[1.3rem] px-4 py-4 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}>
        {status?.wecom_configured
          ? '当前企业微信机器人推送已接入，后续新文章会自动同步到已配置的群机器人。'
          : '当前企业微信机器人还未配置。站长只需在后端环境变量中设置 WECOM_WEBHOOK_URLS 即可启用。'}
      </div>
    </motion.article>
  )
}

export default function FeedsPage() {
  const { settings } = useSite()
  const [searchParams] = useSearchParams()
  const [topics, setTopics] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(true)
  const [subscriptionStatus, setSubscriptionStatus] = useState({
    email_configured: false,
    web_push_configured: false,
    wecom_configured: false,
    web_push_public_key: '',
  })
  const [contentType, setContentType] = useState(searchParams.get('content_type') || '')
  const [topicKey, setTopicKey] = useState(searchParams.get('topic_key') || '')
  const [seriesSlug, setSeriesSlug] = useState(searchParams.get('series_slug') || '')

  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const selectedTopic = useMemo(
    () => topics.find((item) => item.topic_key === topicKey) || null,
    [topicKey, topics],
  )
  const selectedSeries = useMemo(
    () => seriesList.find((item) => item.slug === seriesSlug) || null,
    [seriesList, seriesSlug],
  )
  const orderedTopics = useMemo(() => (
    [...topics]
      .sort((a, b) => {
        if (Boolean(a.is_featured) !== Boolean(b.is_featured)) return a.is_featured ? -1 : 1
        return (b.post_count || 0) - (a.post_count || 0)
      })
      .slice(0, 6)
  ), [topics])
  const orderedSeries = useMemo(() => (
    [...seriesList]
      .sort((a, b) => {
        if (Boolean(a.is_featured) !== Boolean(b.is_featured)) return a.is_featured ? -1 : 1
        return (b.post_count || 0) - (a.post_count || 0)
      })
      .slice(0, 6)
  ), [seriesList])
  const canonicalPath = useMemo(() => {
    const query = searchParams.toString()
    return query ? `/feeds?${query}` : '/feeds'
  }, [searchParams])
  const jsonLd = useMemo(() => ([
    buildCollectionPageJsonLd({
      siteUrl,
      name: '订阅中心',
      description: '集中管理全站、日报、周报、主题和系列的 RSS、邮件与浏览器提醒入口。',
      path: canonicalPath,
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '订阅中心', path: canonicalPath },
      ],
    }),
  ]), [canonicalPath, siteUrl])

  useEffect(() => {
    document.title = '订阅中心 - AI 资讯观察'

    Promise.all([
      fetchTopics({ featured: true, limit: 12 }),
      fetchSeriesList({ limit: 12 }),
      fetchSubscriptionStatus(),
    ])
      .then(([topicsPayload, seriesPayload, statusPayload]) => {
        const topicItems = Array.isArray(topicsPayload?.items)
          ? topicsPayload.items.filter((item) => typeof item?.topic_key === 'string' && item.topic_key.trim().length > 0)
          : []
        setTopics(topicItems)
        setSeriesList(Array.isArray(seriesPayload) ? seriesPayload : [])
        setSubscriptionStatus({
          email_configured: Boolean(statusPayload?.email_configured),
          web_push_configured: Boolean(statusPayload?.web_push_configured),
          wecom_configured: Boolean(statusPayload?.wecom_configured),
          web_push_public_key: statusPayload?.web_push_public_key || '',
        })
      })
      .catch(() => {
        setTopics([])
        setSeriesList([])
        setSubscriptionStatus({
          email_configured: false,
          web_push_configured: false,
          wecom_configured: false,
          web_push_public_key: '',
        })
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title="订阅中心 - AI 资讯观察"
        description="集中管理全站、日报、周报、主题和系列的 RSS、邮件与浏览器提醒入口。"
        path={canonicalPath}
        jsonLd={jsonLd}
        rssUrl={buildPublicApiUrl('/feed.xml')}
      />
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.div initial="hidden" animate="visible" variants={motionContainerVariants}>
          <motion.section variants={motionItemVariants} className="editorial-panel rounded-[2rem] px-8 py-8">
            <EditorialSectionHeader
              eyebrow="订阅中心"
              title="把全站、主题和系列更新都收成稳定回访入口"
              description="这里不只是技术通道列表，更是你的阅读偏好面板。你可以决定只收全站、只收日报或周报，或者进一步锁定某个主题和某个系列。"
            />
            <div className="mt-6 flex flex-wrap gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="inline-flex items-center gap-2 rounded-full px-4 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Sparkles size={15} />
                RSS 适合阅读器，邮件适合收件箱，Web Push 适合第一时间提醒
              </span>
            </div>
          </motion.section>

          <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr),300px]">
            <ScopePicker
              contentType={contentType}
              onContentTypeChange={setContentType}
              topicKey={topicKey}
              onTopicKeyChange={setTopicKey}
              seriesSlug={seriesSlug}
              onSeriesSlugChange={setSeriesSlug}
              topics={topics}
              seriesList={seriesList}
            />
            <ScopeSummaryCard contentType={contentType} topic={selectedTopic} series={selectedSeries} />
          </div>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="核心 RSS"
              title="先接住最常用的 3 条总入口"
              description="如果你已经在用 Feedly、Inoreader 或 Readwise Reader，优先把这些固定 feed 加进去就够用了。"
            />
            <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-6 grid gap-5 lg:grid-cols-3">
              {CORE_FEEDS.map(({ key, ...feed }) => (
                <FeedCard key={key} {...feed} />
              ))}
            </motion.div>
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="主动提醒"
              title="不只看 RSS，也可以把更新主动送过来"
              description="邮件更适合稳态回看，浏览器提醒更适合第一时间知道新变化。它们都会沿用上面这组订阅范围。"
            />
            <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-6 grid gap-5 lg:grid-cols-2">
              <EmailSubscriptionCard
                status={subscriptionStatus}
                contentType={contentType}
                topicKey={topicKey}
                seriesSlug={seriesSlug}
              />
              <BrowserPushCard
                status={subscriptionStatus}
                contentType={contentType}
                topicKey={topicKey}
                seriesSlug={seriesSlug}
              />
            </motion.div>
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="系列订阅"
              title="按阅读路径订阅，而不只是按时间线订阅"
              description="系列强调的是“怎么沿一个栏目持续阅读”。如果你更想跟住某条固定栏目路径，优先订系列更合适。"
            />
            {loading ? (
              <div className="mt-6">
                <LoadingSkeletonSet count={3} className="grid gap-5 lg:grid-cols-2" minHeight="13rem" />
              </div>
            ) : orderedSeries.length > 0 ? (
              <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-6 grid gap-5 lg:grid-cols-2">
                {orderedSeries.map((series) => (
                  <TaxonomyFeedCard key={series.slug} item={series} type="series" />
                ))}
              </motion.div>
            ) : (
              <div className="mt-6">
                <EmptyStatePanel
                  title="暂时还没有可展示的系列订阅"
                  description="随着系列资料继续补齐，这里会优先展示更适合长期回看的栏目 feed。"
                  icon={Newspaper}
                />
              </div>
            )}
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="主题订阅"
              title="只追踪你真正想持续跟进的主线"
              description="主题 feed 更适合只追踪特定公司、模型、产品方向或事件链。"
            />

            {loading ? (
              <div className="mt-6">
                <LoadingSkeletonSet count={4} className="grid gap-5 lg:grid-cols-2" minHeight="13rem" />
              </div>
            ) : orderedTopics.length > 0 ? (
              <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-6 grid gap-5 lg:grid-cols-2">
                {orderedTopics.map((topic) => (
                  <TaxonomyFeedCard key={topic.topic_key} item={topic} type="topic" />
                ))}
              </motion.div>
            ) : (
              <div className="mt-6">
                <EmptyStatePanel
                  title="暂时还没有可展示的主题订阅"
                  description="随着主题资料继续补齐，这里会优先展示更适合长期追踪的主题 feed。"
                  icon={Tags}
                />
              </div>
            )}
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="团队通道"
              title="如果你要把更新同步给团队，也可以走企业微信机器人"
              description="这个通道适合把新文章自动同步到企业微信团队群，不需要读者单独操作。"
            />
            <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mt-6">
              <WecomSubscriptionCard status={subscriptionStatus} />
            </motion.div>
          </section>

          <motion.section variants={motionItemVariants} className="mt-10 editorial-panel rounded-[2rem] px-8 py-8">
            <EditorialSectionHeader
              eyebrow="阅读路径"
              title="不知道先订什么时，可以从这里开始"
              description="如果你偏向高频获取新消息，先订 AI 日报；如果你更偏向结构化回看，先订 AI 周报；如果你只追一个方向，直接订对应主题或系列。"
            />
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                to="/daily"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Newspaper size={15} />
                查看 AI 日报
              </Link>
              <Link
                to="/weekly"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
              >
                <Newspaper size={15} />
                查看 AI 周报
              </Link>
              <span
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
              >
                <RadioTower size={15} />
                企业微信机器人自动推送
              </span>
            </div>
          </motion.section>
        </motion.div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
