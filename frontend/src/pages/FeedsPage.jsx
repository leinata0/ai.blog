import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, Newspaper, Rss, Sparkles, Tags } from 'lucide-react'

import { fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
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

export default function FeedsPage() {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

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
              title="把全站、日报、周报和主题更新接进你的阅读器"
              description="这里集中整理所有稳定可用的 RSS 入口。你可以先订阅全站，也可以只追踪日报、周报或具体主题。"
            />
            <div className="mt-6 flex flex-wrap gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="inline-flex items-center gap-2 rounded-full px-4 py-2" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
                <Sparkles size={15} />
                更适合放进 Feedly、Inoreader、Readwise Reader 等阅读器
              </span>
            </div>
          </motion.section>

          <section className="mt-8">
            <EditorialSectionHeader
              eyebrow="核心订阅"
              title="先从最常用的 3 条订阅开始"
              description="如果你只想快速接入，优先使用全站、日报和周报这三条固定 feed。"
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
            </div>
          </motion.section>
        </motion.div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
