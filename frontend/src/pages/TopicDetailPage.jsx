import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Compass, Rss } from 'lucide-react'

import { fetchTopicDetail, prefetchPostDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import FollowTopicButton from '../components/FollowTopicButton'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import { formatDate } from '../utils/date'
import {
  getContentTypeLabel,
  getTopicDescription,
  getTopicTitle,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function TopicPostCard({ post, onPrefetch }) {
  return (
    <motion.article variants={motionItemVariants} className="editorial-card rounded-[1.8rem] border px-5 py-5">
      <Link
        to={`/posts/${post.slug}`}
        className="block"
        onMouseEnter={() => onPrefetch(post.slug)}
        onFocus={() => onPrefetch(post.slug)}
      >
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
          {post.content_type ? <span>{getContentTypeLabel(post.content_type)}</span> : null}
          {post.coverage_date ? <span>{post.coverage_date}</span> : null}
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {post.title}
        </h3>
        <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
          {post.summary}
        </p>
        <div className="mt-4 text-xs" style={{ color: 'var(--text-faint)' }}>
          {formatDate(post.created_at)}
        </div>
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

    const controller = new AbortController()
    setLoading(true)
    fetchTopicDetail(
      topicKey,
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 20000, staleTtl: 90000 },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        setTopic(payload)
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setTopic(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [topicKey])

  const displayTitle = getTopicTitle(topic || { topic_key: topicKey })
  const rssUrl = useMemo(() => `/api/feeds/topics/${encodeURIComponent(topicKey || '')}.xml`, [topicKey])

  useEffect(() => {
    document.title = `${displayTitle} - AI 资讯观察`
  }, [displayTitle])

  function prefetchPost(slug) {
    prefetchPostDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

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
          className="mt-6"
        >
          <CoverCard
            image={topic?.cover_image}
            imageAlt={displayTitle}
            overlay
            eyebrow="主题主线"
            title={displayTitle}
            description={getTopicDescription(topic)}
            meta={[
              topic?.post_count ? `${topic.post_count} 篇文章` : '持续更新',
              topic?.source_count ? `${topic.source_count} 条来源` : '',
              topic?.latest_post_at ? `最近更新 ${formatDate(topic.latest_post_at)}` : '',
            ].filter(Boolean)}
            footer={(
              <div className="flex flex-wrap gap-3">
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
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"
                  style={{ backgroundColor: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
                >
                  <Rss size={15} />
                  订阅这个主题的 RSS
                </a>
              </div>
            )}
          />
        </motion.section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr),300px]">
          <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            {loading ? (
              <LoadingSkeletonSet count={3} minHeight="14rem" />
            ) : (topic?.posts || topic?.timeline || []).length > 0 ? (
              (topic?.posts?.length ? topic.posts : topic.timeline).map((post) => (
                <TopicPostCard key={post.slug} post={post} onPrefetch={prefetchPost} />
              ))
            ) : (
              <EmptyStatePanel
                title="这个主题下还没有可展示的文章"
                description="稍后会随着自动发文和主题归档持续补齐。"
                icon={Compass}
              />
            )}
          </motion.div>

          <motion.aside initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            <motion.section variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-5 py-5">
              <EditorialSectionHeader
                eyebrow="主题摘要"
                title="这条主线在看什么"
                titleClassName="!text-[1.45rem]"
                description={topic?.quality_summary?.summary || '当一条主线足够重要时，它会同时出现在日报、周报和系列内容中。'}
              />
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
              <motion.section variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-5 py-5">
                <EditorialSectionHeader
                  eyebrow="相关系列"
                  title="沿着栏目继续往下看"
                  titleClassName="!text-[1.45rem]"
                />
                <div className="mt-4 space-y-3">
                  {topic.related_series.map((series) => (
                    <Link
                      key={series.slug}
                      to={`/series/${series.slug}`}
                      className="block rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                    >
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {series.title}
                      </div>
                      <div className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
                        {series.description || '进入系列页继续阅读。'}
                      </div>
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
