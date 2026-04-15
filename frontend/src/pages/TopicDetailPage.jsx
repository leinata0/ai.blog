import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Compass, Rss, Sparkles } from 'lucide-react'

import { fetchTopicDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import FollowTopicButton from '../components/FollowTopicButton'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import {
  getContentTypeLabel,
  getTopicDescription,
  getTopicTitle,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function TopicPostCard({ post }) {
  return (
    <motion.article
      variants={motionItemVariants}
      className="editorial-card rounded-3xl border px-5 py-5"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
    >
      <Link to={`/posts/${post.slug}`} className="block">
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
          {post.content_type ? <span>{getContentTypeLabel(post.content_type)}</span> : null}
          {post.coverage_date ? <span>{post.coverage_date}</span> : null}
        </div>
        <h3 className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h3>
        <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        <div className="mt-3 text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(post.created_at)}</div>
      </Link>
    </motion.article>
  )
}

export default function TopicDetailPage() {
  const { topicKey } = useParams()
  const [topic, setTopic] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!topicKey) return
    fetchTopicDetail(topicKey)
      .then(setTopic)
      .catch(() => setTopic(null))
      .finally(() => setLoading(false))
  }, [topicKey])

  const displayTitle = getTopicTitle(topic || { topic_key: topicKey })
  const rssUrl = useMemo(() => `/api/feeds/topics/${encodeURIComponent(topicKey || '')}.xml`, [topicKey])

  useEffect(() => {
    document.title = `${displayTitle} - 极客开发日志`
  }, [displayTitle])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <Link to="/topics" className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-faint)' }}>
          <ArrowLeft size={14} />
          返回主题页
        </Link>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="mt-6 editorial-panel rounded-3xl px-8 py-8"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr),280px]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}>
                <Sparkles size={12} />
                主题主线
              </div>
              <h1 className="mt-4 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{displayTitle}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                {getTopicDescription(topic)}
              </p>
              <div className="mt-5 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                {topic?.post_count ? <span>{topic.post_count} 篇文章</span> : null}
                {topic?.source_count ? <span>{topic.source_count} 个来源</span> : null}
                {topic?.latest_post_at ? <span>最近更新 {formatDate(topic.latest_post_at)}</span> : null}
                {topic?.avg_quality_score ? <span>平均质量分 {topic.avg_quality_score}</span> : null}
                {topicKey ? <span>topic_key：{topicKey}</span> : null}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <FollowTopicButton
                  topic={{
                    topic_key: topicKey,
                    display_title: displayTitle,
                    description: topic?.description || '',
                    cover_image: topic?.cover_image || '',
                    latest_post_at: topic?.latest_post_at || null,
                  }}
                />
                <a
                  href={rssUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Rss size={15} />
                  订阅这个主题的 RSS
                </a>
              </div>
            </div>
            {topic?.cover_image ? (
              <div className="overflow-hidden rounded-3xl">
                <img src={proxyImageUrl(topic.cover_image)} alt={displayTitle} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
              </div>
            ) : (
              <div className="flex min-h-[220px] items-end rounded-3xl p-5" style={{ background: 'linear-gradient(160deg, rgba(73,177,245,0.18), rgba(37,99,235,0.08))' }}>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: '#2563eb' }}>Topic</div>
                  <div className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{displayTitle}</div>
                </div>
              </div>
            )}
          </div>
        </motion.section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr),280px]">
          <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            {loading ? (
              [1, 2, 3].map((item) => (
                <motion.div key={item} variants={motionItemVariants} className="h-36 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
              ))
            ) : (topic?.posts || topic?.timeline || []).length > 0 ? (
              (topic?.posts?.length ? topic.posts : topic.timeline).map((post) => (
                <TopicPostCard key={post.slug} post={post} />
              ))
            ) : (
              <motion.div variants={motionItemVariants} className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <p style={{ color: 'var(--text-faint)' }}>这个主题下还没有可展示的文章，稍后会随着自动发文持续补齐。</p>
              </motion.div>
            )}
          </motion.div>

          <motion.aside initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            <motion.section variants={motionItemVariants} className="editorial-panel rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
                <Compass size={15} />
                主题摘要
              </div>
              <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                {topic?.quality_summary?.summary || '当一条主线足够重要时，它会同时出现在日报、周报和系列内容中。'}
              </p>
              {Array.isArray(topic?.aliases) && topic.aliases.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {topic.aliases.slice(0, 8).map((alias) => (
                    <span key={alias} className="rounded-full px-3 py-1 text-xs" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}>
                      {alias}
                    </span>
                  ))}
                </div>
              ) : null}
            </motion.section>

            {(topic?.related_series || []).length > 0 ? (
              <motion.section variants={motionItemVariants} className="editorial-panel rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>相关系列</h2>
                <div className="mt-4 space-y-3">
                  {topic.related_series.map((series) => (
                    <Link key={series.slug} to={`/series/${series.slug}`} className="block rounded-2xl border border-transparent px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]">
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{series.title}</div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{series.description || '进入系列页继续阅读。'}</div>
                    </Link>
                  ))}
                </div>
              </motion.section>
            ) : null}
          </motion.aside>
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
