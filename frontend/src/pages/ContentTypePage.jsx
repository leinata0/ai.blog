import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

import { fetchDiscover, fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import {
  CONTENT_TYPE_META,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

const COPY = {
  daily_brief: {
    title: 'AI 日报',
    englishTitle: 'AI Daily Brief',
    description: '聚焦当天最值得跟进的 AI 消息、产品更新与行业信号。',
  },
  weekly_review: {
    title: 'AI 周报',
    englishTitle: 'AI Weekly Review',
    description: '从一周视角梳理关键变化，帮助你快速回看主线与趋势。',
  },
}

function sortByCreatedTime(posts) {
  return [...posts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function HeroCard({ post, label }) {
  const cover = post?.cover_image ? proxyImageUrl(post.cover_image) : ''

  if (!post) return null

  return (
    <motion.article
      variants={motionItemVariants}
      className="group overflow-hidden rounded-3xl border"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-muted)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <Link to={`/posts/${post.slug}`} className="block">
        <div className="relative h-72 overflow-hidden sm:h-80">
          {cover ? (
            <img
              src={cover}
              alt={post.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background:
                  'linear-gradient(140deg, rgba(37,99,235,0.2), rgba(14,165,233,0.08), rgba(255,255,255,0.7))',
              }}
            />
          )}
          <div className="absolute left-4 top-4">
            <span
              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: CONTENT_TYPE_META[label]?.background || 'var(--accent-soft)',
                color: CONTENT_TYPE_META[label]?.accent || 'var(--accent)',
              }}
            >
              最新一篇
            </span>
          </div>
        </div>

        <div className="px-6 py-6 sm:px-8">
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {post.coverage_date || formatDate(post.created_at)}
          </div>
          <h2 className="mt-3 text-2xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
            {post.title}
          </h2>
          <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            {post.summary}
          </p>
        </div>
      </Link>
    </motion.article>
  )
}

function PostCard({ post }) {
  const cover = post?.cover_image ? proxyImageUrl(post.cover_image) : ''

  return (
    <motion.article
      variants={motionItemVariants}
      className="group overflow-hidden rounded-3xl border"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-muted)',
        boxShadow: 'var(--card-shadow)',
      }}
    >
      <Link to={`/posts/${post.slug}`} className="block">
        <div className="flex flex-col sm:flex-row">
          <div className="h-44 w-full overflow-hidden sm:h-auto sm:w-64 sm:flex-shrink-0">
            {cover ? (
              <img
                src={cover}
                alt={post.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                className="h-full w-full min-h-44"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(14,165,233,0.06), rgba(255,255,255,0.7))',
                }}
              />
            )}
          </div>
          <div className="flex-1 px-6 py-5">
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {post.coverage_date || formatDate(post.created_at)}
            </div>
            <h3 className="mt-2 text-xl font-semibold leading-snug" style={{ color: 'var(--text-primary)' }}>
              {post.title}
            </h3>
            <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
              {post.summary}
            </p>
          </div>
        </div>
      </Link>
    </motion.article>
  )
}

export default function ContentTypePage({ contentType }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const copy = COPY[contentType] || COPY.daily_brief

  useEffect(() => {
    document.title = `${copy.title} - AI 博客`
    setLoading(true)
    fetchDiscover({ content_type: contentType })
      .then((payload) => setPosts(Array.isArray(payload?.items) ? payload.items : []))
      .catch(async () => {
        const fallback = await fetchPosts({ pageSize: 50 })
        setPosts((fallback.items || []).filter((post) => post.content_type === contentType))
      })
      .finally(() => setLoading(false))
  }, [contentType, copy.title])

  const orderedPosts = useMemo(() => sortByCreatedTime(posts), [posts])
  const heroPost = orderedPosts[0] || null
  const restPosts = orderedPosts.slice(1)

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.div initial="hidden" animate="visible" variants={motionContainerVariants}>
          <motion.section variants={motionItemVariants} className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
              {copy.englishTitle}
            </p>
            <h1 className="mt-3 text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {copy.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
              {copy.description}
            </p>
          </motion.section>

          <div className="space-y-5">
            {loading ? (
              [1, 2, 3].map((item) => (
                <div key={item} className="h-36 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
              ))
            ) : orderedPosts.length === 0 ? (
              <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <p style={{ color: 'var(--text-faint)' }}>这里暂时还没有内容。</p>
              </div>
            ) : (
              <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-5">
                <HeroCard post={heroPost} label={contentType} />
                {restPosts.map((post) => (
                  <PostCard key={post.slug} post={post} />
                ))}
              </motion.div>
            )}
          </div>
        </motion.div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
