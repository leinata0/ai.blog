import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowUpRight,
  BellRing,
  Mail,
  Newspaper,
  RadioTower,
  Rss,
  Sparkles,
  Tags,
} from 'lucide-react'

import { fetchTopics } from '../api/posts'
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
import { urlBase64ToUint8Array } from '../utils/webPush'
import {
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

const CORE_FEEDS = [
  {
    key: 'site',
    title: '全站更新',
    description: '追踪整个站点的最新发布，适合放进你的 RSS 阅读器做统一订阅。',
    href: '/feed.xml',
    eyebrow: '全站 RSS',
  },
  {
    key: 'daily',
    title: 'AI 日报',
    description: '只订阅每日更新的日报流，更适合高频关注当日重要变化。',
    href: '/api/feeds/daily.xml',
    eyebrow: '日报 RSS',
  },
  {
    key: 'weekly',
    title: 'AI 周报',
    description: '只订阅每周整理后的周报主线，适合做低频但更完整的回看。',
    href: '/api/feeds/weekly.xml',
    eyebrow: '周报 RSS',
  },
]

const SUBSCRIPTION_OPTIONS = [
  { value: 'all', label: '全站更新' },
  { value: 'daily_brief', label: 'AI 日报' },
  { value: 'weekly_review', label: 'AI 周报' },
]

function FeedCard({ eyebrow, title, description, href }) {
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
          打开订阅地址
        </a>
      </div>
    </motion.article>
  )
}

function TopicFeedCard({ topic }) {
  const href = `/api/feeds/topics/${encodeURIComponent(topic.topic_key)}.xml`

  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-[1.8rem] border px-5 py-5"
      style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="section-kicker">主题 RSS</div>
          <h3 className="mt-3 font-display text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {topic.display_title || topic.topic_key}
          </h3>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            {topic.description || '按主题订阅这条持续更新的内容主线。'}
          </p>
        </div>
        <Link
          to={`/topics/${topic.topic_key}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          主题页
          <ArrowUpRight size={12} />
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
        {topic.post_count ? <span>{topic.post_count} 篇文章</span> : null}
        {topic.source_count ? <span>{topic.source_count} 条来源</span> : null}
      </div>

      <div className="mt-5">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
          style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
        >
          <Rss size={15} />
          订阅这个主题
        </a>
      </div>
    </motion.article>
  )
}

function OptionPicker({ value, onChange, disabled = false }) {
  function toggleOption(optionValue) {
    const current = Array.isArray(value) ? value : []
    const next = current.includes(optionValue)
      ? current.filter((item) => item !== optionValue)
      : [...current, optionValue]
    onChange(next.length > 0 ? next : ['all'])
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {SUBSCRIPTION_OPTIONS.map((option) => {
        const active = value.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => toggleOption(option.value)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-canvas)',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
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

function EmailSubscriptionCard({ status }) {
  const [email, setEmail] = useState('')
  const [contentTypes, setContentTypes] = useState(['all'])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const result = await subscribeEmail({ email, content_types: contentTypes })
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
            让新文章直接送到你的邮箱
          </h3>
        </div>
        <ChannelStatusBadge
          enabled={Boolean(status?.email_configured)}
          readyText="已接入"
          pendingText="待配置"
        />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        适合不常开 RSS 阅读器的读者。可以按全站、日报、周报来接收更新。
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

        <OptionPicker value={contentTypes} onChange={setContentTypes} disabled={saving} />

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
              当前已允许登记邮箱，站点还需要完成邮件服务配置后才会开始投递。
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

function BrowserPushCard({ status }) {
  const [contentTypes, setContentTypes] = useState(['all'])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [permission, setPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'default',
  )

  const pushSupported =
    typeof window !== 'undefined'
    && window.isSecureContext
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window

  useEffect(() => {
    if (!pushSupported) return

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
        if (!cancelled) {
          setSubscribed(false)
        }
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
        content_types: contentTypes,
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
            在当前浏览器直接接收新内容通知
          </h3>
        </div>
        <ChannelStatusBadge
          enabled={Boolean(status?.web_push_configured)}
          readyText="已接入"
          pendingText="待配置"
        />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        适合想第一时间知道新内容更新的读者。需要在 HTTPS 环境下授予浏览器通知权限。
      </p>

      <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        <span>浏览器状态：{pushSupported ? '支持 Web Push' : '当前环境不支持'}</span>
        <span>通知权限：{permission === 'granted' ? '已允许' : permission === 'denied' ? '已拒绝' : '待选择'}</span>
        <span>当前设备：{subscribed ? '已订阅' : '未订阅'}</span>
      </div>

      <OptionPicker value={contentTypes} onChange={setContentTypes} disabled={busy || subscribed} />

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
            适合把新文章同步到团队群
          </h3>
        </div>
        <ChannelStatusBadge
          enabled={Boolean(status?.wecom_configured)}
          readyText="已接入"
          pendingText="待配置"
        />
      </div>

      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
        这个通道适合站长或团队内部使用。配置企业微信机器人的 webhook 后，站点发布新内容时会自动向群内推送摘要和直达链接。
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
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)
  const [subscriptionStatus, setSubscriptionStatus] = useState({
    email_configured: false,
    web_push_configured: false,
    wecom_configured: false,
    web_push_public_key: '',
  })

  useEffect(() => {
    document.title = '订阅中心 - AI 资讯观察'

    fetchTopics({ featured: true, limit: 12 })
      .then((payload) => {
        const items = Array.isArray(payload?.items)
          ? payload.items.filter((item) => typeof item?.topic_key === 'string' && item.topic_key.trim().length > 0)
          : []
        setTopics(items)
      })
      .catch(() => setTopics([]))
      .finally(() => setLoading(false))

    fetchSubscriptionStatus()
      .then((payload) => {
        setSubscriptionStatus({
          email_configured: Boolean(payload?.email_configured),
          web_push_configured: Boolean(payload?.web_push_configured),
          wecom_configured: Boolean(payload?.wecom_configured),
          web_push_public_key: payload?.web_push_public_key || '',
        })
      })
      .catch(() => {
        setSubscriptionStatus({
          email_configured: false,
          web_push_configured: false,
          wecom_configured: false,
          web_push_public_key: '',
        })
      })
  }, [])

  const curatedTopics = useMemo(() => {
    return [...topics]
      .sort((a, b) => {
        if (Boolean(a.is_featured) !== Boolean(b.is_featured)) {
          return a.is_featured ? -1 : 1
        }
        return (b.post_count || 0) - (a.post_count || 0)
      })
      .slice(0, 8)
  }, [topics])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.div initial="hidden" animate="visible" variants={motionContainerVariants}>
          <motion.section variants={motionItemVariants} className="editorial-panel rounded-[2rem] px-8 py-8">
            <EditorialSectionHeader
              eyebrow="订阅中心"
              title="把 RSS、邮件、浏览器提醒和团队推送都接进来"
              description="这里集中整理所有稳定可用的订阅入口。你可以继续使用 RSS，也可以换成邮件、浏览器提醒或团队机器人推送。"
            />
            <div className="mt-6 flex flex-wrap gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="inline-flex items-center gap-2 rounded-full px-4 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Sparkles size={15} />
                RSS 适合阅读器，邮件适合收件箱，Web Push 适合第一时间提醒
              </span>
            </div>
          </motion.section>

          <section className="mt-8">
            <EditorialSectionHeader
              eyebrow="核心订阅"
              title="先从最常用的 3 条 RSS 订阅开始"
              description="如果你已经在用 Feedly、Inoreader、Readwise Reader 这类工具，优先使用这些固定 feed。"
            />
            <motion.div
              initial="hidden"
              animate="visible"
              variants={motionContainerVariants}
              className="mt-6 grid gap-5 lg:grid-cols-3"
            >
              {CORE_FEEDS.map(({ key, ...feed }) => (
                <FeedCard key={key} {...feed} />
              ))}
            </motion.div>
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="主动提醒"
              title="不用只盯着 RSS，你也可以让更新主动来找你"
              description="邮件和浏览器提醒更适合不常打开 RSS 阅读器、但又不想错过新内容的读者。"
            />
            <motion.div
              initial="hidden"
              animate="visible"
              variants={motionContainerVariants}
              className="mt-6 grid gap-5 lg:grid-cols-2"
            >
              <EmailSubscriptionCard status={subscriptionStatus} />
              <BrowserPushCard status={subscriptionStatus} />
            </motion.div>
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="团队通道"
              title="如果你要把更新同步给团队，也可以走企业微信机器人"
              description="这个通道适合把新文章自动同步到企业微信团队群，不需要读者单独操作。"
            />
            <motion.div
              initial="hidden"
              animate="visible"
              variants={motionContainerVariants}
              className="mt-6"
            >
              <WecomSubscriptionCard status={subscriptionStatus} />
            </motion.div>
          </section>

          <section className="mt-10">
            <EditorialSectionHeader
              eyebrow="主题订阅"
              title="订阅你真正想持续追踪的主线"
              description="主题 feed 更适合只追踪特定公司、模型、产品方向或事件链。"
            />

            {loading ? (
              <div className="mt-6">
                <LoadingSkeletonSet count={4} className="grid gap-5 lg:grid-cols-2" minHeight="13rem" />
              </div>
            ) : curatedTopics.length > 0 ? (
              <motion.div
                initial="hidden"
                animate="visible"
                variants={motionContainerVariants}
                className="mt-6 grid gap-5 lg:grid-cols-2"
              >
                {curatedTopics.map((topic) => (
                  <TopicFeedCard key={topic.topic_key} topic={topic} />
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

          <motion.section variants={motionItemVariants} className="mt-10 editorial-panel rounded-[2rem] px-8 py-8">
            <EditorialSectionHeader
              eyebrow="阅读路径"
              title="不知道先订什么时，可以从这里开始"
              description="如果你偏向高频获取新消息，先订 AI 日报；如果你更偏向结构化回看，先订 AI 周报；如果你只追一个方向，直接订对应主题。"
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
