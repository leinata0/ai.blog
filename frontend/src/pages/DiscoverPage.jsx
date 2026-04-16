import { startTransition, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Compass, Search, Sparkles } from 'lucide-react'

import {
  fetchDiscover,
  fetchSearch,
  fetchSeriesList,
  fetchTopics,
  prefetchPostDetail,
  prefetchTopicDetail,
} from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import {
  getContentTypeLabel,
  getSeriesTitle,
  getTopicBadgeLabel,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function DiscoverCard({ post, seriesTitle, topicTitle, onPrefetch }) {
  return (
    <motion.div
      variants={motionItemVariants}
      whileHover={hoverLift}
      onMouseEnter={() => onPrefetch(post.slug)}
      onFocus={() => onPrefetch(post.slug)}
    >
      <CoverCard
        to={`/posts/${post.slug}`}
        image={post.cover_image}
        imageAlt={post.title}
        eyebrow={getContentTypeLabel(post.content_type)}
        title={post.title}
        description={post.summary}
        meta={[
          topicTitle ? `主题：${topicTitle}` : '',
          seriesTitle ? `系列：${seriesTitle}` : '',
          post.coverage_date || '',
        ].filter(Boolean)}
      />
    </motion.div>
  )
}

export default function DiscoverPage() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({ content_type: '', series: '' })
  const [posts, setPosts] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '发现 - AI 资讯观察'
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetchSeriesList(
      { limit: 12 },
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 30000, staleTtl: 120000 },
    )
      .then((items) => {
        if (controller.signal.aborted) return
        startTransition(() => setSeriesList(items))
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setSeriesList([])
      })

    fetchTopics(
      { featured: true, limit: 6 },
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 30000, staleTtl: 120000 },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        const nextTopics = Array.isArray(payload?.items) ? payload.items : []
        startTransition(() => setTopics(nextTopics))
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setTopics([])
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    const loader = query || filters.content_type || filters.series
      ? fetchSearch(
          {
            q: query || undefined,
            content_type: filters.content_type || undefined,
            series_slug: filters.series || undefined,
            sort: 'relevance',
          },
          { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
        )
      : fetchDiscover(
          {
            content_type: filters.content_type || undefined,
            series: filters.series || undefined,
            sections: 'items,total',
          },
          { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
        )

    loader
      .then((payload) => {
        if (controller.signal.aborted) return
        startTransition(() => setPosts(payload.items || []))
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setPosts([])
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [filters.content_type, filters.series, query])

  const emptyMessage = useMemo(() => {
    if (query || filters.content_type || filters.series) {
      return '当前筛选下还没有匹配内容。可以换个关键词，或先进入主题页继续追踪。'
    }
    return '这里会持续聚合值得继续追踪的主题、系列和内容入口。'
  }, [filters.content_type, filters.series, query])

  const seriesBySlug = useMemo(
    () => Object.fromEntries(seriesList.map((series) => [series.slug, getSeriesTitle(series)])),
    [seriesList],
  )
  const topicByKey = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.topic_key, getTopicTitle(topic)])),
    [topics],
  )

  function prefetchPost(slug) {
    prefetchPostDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  function prefetchTopic(topicKey) {
    prefetchTopicDetail(topicKey, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
        >
          <EditorialSectionHeader
            eyebrow="内容发现"
            title="发现值得继续追踪的 AI 主线"
            description="这里把日报、周报、系列和主题入口重新编排成一个更适合持续浏览的发现页。"
          />

          <div className="mt-6 grid gap-4 md:grid-cols-[1.5fr,1fr,1fr]">
            <label className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、摘要或主题"
                className="w-full rounded-[1.3rem] border px-10 py-3 text-sm outline-none transition-colors"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              />
            </label>

            <select
              value={filters.content_type}
              onChange={(event) => setFilters((current) => ({ ...current, content_type: event.target.value }))}
              className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部类型</option>
              <option value="daily_brief">日报</option>
              <option value="weekly_review">周报</option>
            </select>

            <select
              value={filters.series}
              onChange={(event) => setFilters((current) => ({ ...current, series: event.target.value }))}
              className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部系列</option>
              {seriesList.map((series) => (
                <option key={series.slug} value={series.slug}>
                  {getSeriesTitle(series)}
                </option>
              ))}
            </select>
          </div>
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 rounded-[2rem] px-6 py-6"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <EditorialSectionHeader
            eyebrow="推荐主题"
            title="先从主线入口继续追踪"
            description="如果你还没有明确要看哪篇文章，可以先从推荐主题进入，再顺着同主题的日报、周报和系列往下看。"
          />

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {topics.length > 0 ? topics.slice(0, 6).map((topic) => (
              <motion.div
                key={topic.topic_key}
                variants={motionItemVariants}
                onMouseEnter={() => prefetchTopic(topic.topic_key)}
                onFocus={() => prefetchTopic(topic.topic_key)}
              >
                <CoverCard
                  to={`/topics/${topic.topic_key}`}
                  title={getTopicTitle(topic)}
                  description={topic.post_count ? `${topic.post_count} 篇文章可继续阅读` : '进入主题页继续浏览'}
                  eyebrow={topic.is_featured ? '推荐主题' : '主题主线'}
                  badge={(
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{ backgroundColor: topic.is_featured ? 'rgba(37, 99, 235, 0.12)' : 'var(--accent-soft)', color: topic.is_featured ? '#2563eb' : 'var(--accent)' }}
                    >
                      {getTopicBadgeLabel(topic)}
                    </span>
                  )}
                  className="h-full"
                />
              </motion.div>
            )) : (
              <div className="md:col-span-3">
                <EmptyStatePanel
                  title="推荐主题会在这里展示"
                  description="当主题入口积累起来后，这里会优先展示更值得长期追踪的主线。"
                  icon={Sparkles}
                />
              </div>
            )}
          </div>
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 grid gap-5 md:grid-cols-2"
        >
          {loading ? (
            <LoadingSkeletonSet count={4} className="contents" itemClassName="rounded-[1.8rem]" minHeight="20rem" />
          ) : posts.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyStatePanel title="还没有匹配内容" description={emptyMessage} icon={Compass} />
            </div>
          ) : posts.map((post) => (
            <DiscoverCard
              key={post.slug}
              post={post}
              onPrefetch={prefetchPost}
              seriesTitle={post.series_slug ? seriesBySlug[post.series_slug] || post.series_slug : ''}
              topicTitle={post.topic_key ? topicByKey[post.topic_key] || post.topic_key : ''}
            />
          ))}
        </motion.section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
