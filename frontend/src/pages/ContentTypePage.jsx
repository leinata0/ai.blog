import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Rss } from 'lucide-react'

import { fetchDiscover, fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import { formatDate } from '../utils/date'
import {
  CONTENT_TYPE_META,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function sortByCreatedTime(posts) {
  return [...posts].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function HeroCard({ post, meta }) {
  if (!post) return null

  return (
    <motion.div variants={motionItemVariants}>
      <CoverCard
        to={`/posts/${post.slug}`}
        image={post.cover_image}
        imageAlt={post.title}
        overlay
        eyebrow={meta.kicker}
        badge={(
          <span
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: meta.background, color: meta.accent }}
          >
            最新一篇
          </span>
        )}
        title={post.title}
        description={post.summary}
        meta={[post.coverage_date || formatDate(post.created_at), meta.label]}
        footer={<span className="inline-flex items-center gap-2 font-semibold">阅读全文 <ArrowRight size={14} /></span>}
      />
    </motion.div>
  )
}

function ListCard({ post, meta }) {
  return (
    <motion.article variants={motionItemVariants}>
      <CoverCard
        to={`/posts/${post.slug}`}
        image={post.cover_image}
        imageAlt={post.title}
        eyebrow={meta.label}
        title={post.title}
        description={post.summary}
        meta={[post.coverage_date || formatDate(post.created_at)]}
        className="h-full"
      />
    </motion.article>
  )
}

export default function ContentTypePage({ contentType }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const copy = CONTENT_TYPE_META[contentType] || CONTENT_TYPE_META.daily_brief
  const feedUrl = contentType === 'weekly_review' ? '/api/feeds/weekly.xml' : '/api/feeds/daily.xml'

  useEffect(() => {
    document.title = `${copy.title} - AI 资讯观察`
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
          <motion.section variants={motionItemVariants} className="editorial-panel rounded-[2rem] px-8 py-8">
            <EditorialSectionHeader
              eyebrow={copy.englishTitle}
              title={copy.title}
              description={`${copy.description} 这里会优先展示最新一篇，并把其余内容整理成更适合连续浏览的栏目列表。`}
            />
            <div className="mt-5 flex flex-wrap gap-3">
              <a
                href={feedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Rss size={15} />
                订阅 {copy.title} RSS
              </a>
              <Link
                to="/feeds"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
              >
                查看全部订阅入口
                <ArrowRight size={14} />
              </Link>
            </div>
          </motion.section>

          <div className="mt-8 space-y-6">
            {loading ? (
              <>
                <LoadingSkeletonSet count={1} minHeight="22rem" />
                <LoadingSkeletonSet count={3} className="grid gap-5 lg:grid-cols-2" minHeight="16rem" />
              </>
            ) : orderedPosts.length === 0 ? (
              <EmptyStatePanel
                title={`${copy.title} 暂时还没有内容`}
                description="新的栏目文章发布后，会优先展示在这里。"
              />
            ) : (
              <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-6">
                <HeroCard post={heroPost} meta={copy} />

                <EditorialSectionHeader
                  eyebrow="更多内容"
                  title={`继续浏览${copy.title}`}
                  description="向下浏览同栏目内容，保持同一阅读节奏与主题密度。"
                />

                <div className="grid gap-5 lg:grid-cols-2">
                  {restPosts.map((post) => (
                    <ListCard key={post.slug} post={post} meta={copy} />
                  ))}
                </div>
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
