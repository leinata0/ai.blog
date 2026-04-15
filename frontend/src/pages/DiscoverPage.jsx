import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Compass, Search, Sparkles } from 'lucide-react'

import { fetchDiscover, fetchSearch, fetchSeriesList, fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import {
  getContentTypeLabel,
  getSeriesTitle,
  getTopicBadgeLabel,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'
import { proxyImageUrl } from '../utils/proxyImage'

function DiscoverCard({ post, seriesTitle, topicTitle }) {
  return (
    <motion.article
      variants={motionItemVariants}
      whileHover={hoverLift}
      className="editorial-card overflow-hidden rounded-3xl border"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
    >
      <Link to={`/posts/${post.slug}`} className="block">
        {post.cover_image ? (
          <div className="editorial-cover h-48 overflow-hidden">
            <img
              src={proxyImageUrl(post.cover_image)}
              alt={post.title}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {getContentTypeLabel(post.content_type)}
            </span>
            {seriesTitle ? <span>系列：{seriesTitle}</span> : null}
            {topicTitle ? <span>主题：{topicTitle}</span> : null}
            {post.coverage_date ? <span>{post.coverage_date}</span> : null}
          </div>
          <h2 className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </div>
      </Link>
    </motion.article>
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
    document.title = '发现 - 极客开发日志'
    fetchSeriesList().then(setSeriesList).catch(() => setSeriesList([]))
    fetchTopics({ featured: true, page_size: 6 }).then((payload) => {
      setTopics(Array.isArray(payload?.items) ? payload.items : [])
    }).catch(() => setTopics([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    const loader = query || filters.content_type || filters.series
      ? fetchSearch({
          q: query || undefined,
          content_type: filters.content_type || undefined,
          series_slug: filters.series || undefined,
          sort: 'relevance',
        })
      : fetchDiscover({
          content_type: filters.content_type || undefined,
          series: filters.series || undefined,
        })

    loader
      .then((payload) => setPosts(payload.items || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false))
  }, [filters.content_type, filters.series, query])

  const emptyMessage = useMemo(() => {
    if (query || filters.content_type || filters.series) {
      return '当前筛选下还没有匹配内容，可以换个关键词，或先进入主题页继续追踪。'
    }
    return '这里会持续聚合值得继续追踪的主题、系列与内容入口。'
  }, [filters, query])

  const seriesBySlug = useMemo(
    () => Object.fromEntries(seriesList.map((series) => [series.slug, getSeriesTitle(series)])),
    [seriesList],
  )
  const topicByKey = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.topic_key, getTopicTitle(topic)])),
    [topics],
  )

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-3xl px-8 py-8"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
            <Compass size={16} />
            内容发现
          </div>
          <h1 className="mt-3 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            发现值得继续追踪的 AI 主线
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            这里把日报、周报、系列和主题入口重新编排成一个更适合持续浏览的发现页。
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-[1.5fr,1fr,1fr]">
            <label className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、摘要或主题"
                className="w-full rounded-2xl border px-10 py-3 text-sm outline-none transition-colors"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              />
            </label>
            <select
              value={filters.content_type}
              onChange={(event) => setFilters((current) => ({ ...current, content_type: event.target.value }))}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部类型</option>
              <option value="daily_brief">日报</option>
              <option value="weekly_review">周报</option>
            </select>
            <select
              value={filters.series}
              onChange={(event) => setFilters((current) => ({ ...current, series: event.target.value }))}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部系列</option>
              {seriesList.map((series) => <option key={series.slug} value={series.slug}>{series.title}</option>)}
            </select>
          </div>
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 rounded-3xl px-6 py-6"
          style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            <Sparkles size={15} />
            推荐主题
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {topics.length > 0 ? topics.slice(0, 6).map((topic) => (
              <motion.div key={topic.topic_key} variants={motionItemVariants}>
                <Link
                  to={`/topics/${topic.topic_key}`}
                  className="block rounded-2xl border border-transparent px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{getTopicTitle(topic)}</div>
                    <span className="rounded-full px-2.5 py-1 text-[11px]" style={{ backgroundColor: topic.is_featured ? 'rgba(37, 99, 235, 0.12)' : 'var(--accent-soft)', color: topic.is_featured ? '#2563eb' : 'var(--accent)' }}>
                      {getTopicBadgeLabel(topic)}
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                    {topic.post_count ? `${topic.post_count} 篇文章` : '主题页'}
                  </div>
                </Link>
              </motion.div>
            )) : (
              <div className="md:col-span-3 text-sm" style={{ color: 'var(--text-faint)' }}>推荐主题会在这里展示。</div>
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
            [1, 2, 3, 4].map((item) => (
              <motion.div key={item} variants={motionItemVariants} className="h-72 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))
          ) : posts.length === 0 ? (
            <motion.div variants={motionItemVariants} className="rounded-3xl px-8 py-10 md:col-span-2" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <p style={{ color: 'var(--text-faint)' }}>{emptyMessage}</p>
            </motion.div>
          ) : posts.map((post) => (
            <DiscoverCard
              key={post.slug}
              post={post}
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
