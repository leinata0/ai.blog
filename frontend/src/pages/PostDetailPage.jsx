import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Heart, Pin } from 'lucide-react'
import { motion, useScroll, useSpring } from 'framer-motion'

import { fetchPostDetail, likePost, fetchRelatedPosts, prefetchPostDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import Navbar from '../components/Navbar'
import TableOfContents from '../components/TableOfContents'
import CommentSection from '../components/CommentSection'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import ArticleSkeleton from '../components/ArticleSkeleton'
import FollowTopicButton from '../components/FollowTopicButton'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { recordReadingHistory } from '../utils/topicRetention'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { buildSubscriptionCenterHref } from '../utils/subscriptionLinks'
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
} from '../utils/structuredData'
import {
  getContentTypeMeta,
  getSeriesTitle,
} from '../utils/contentPresentation'

const ArticleMarkdownRenderer = lazy(() => import('../components/ArticleMarkdownRenderer'))

function calcReadingTime(text) {
  if (!text) return 1
  const charCount = text.replace(/[#*`\->\[\]()!|]/g, '').length
  return Math.max(1, Math.ceil(charCount / 500))
}

function DetailRailSection({ title, items, toPostLabel = false, onPrefetch }) {
  if (!items || items.length === 0) return null

  return (
    <section className="editorial-panel rounded-[1.8rem] p-5">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link
            key={item.slug}
            to={`/posts/${item.slug}`}
            onMouseEnter={() => onPrefetch?.(item.slug)}
            onFocus={() => onPrefetch?.(item.slug)}
            className="block rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
          >
            {toPostLabel && item.content_type ? (
              <div className="mb-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {getContentTypeMeta(item.content_type)?.label || item.content_type}
              </div>
            ) : null}
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(item.created_at)}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function SourceSummarySection({ post }) {
  const sources = Array.isArray(post?.sources) ? post.sources : []
  const summary = post?.source_summary || ''
  if (!summary && sources.length === 0) return null
  const primarySource = sources.find((item) => item.is_primary) || sources[0] || null

  return (
    <section className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-8">
      <EditorialSectionHeader
        eyebrow="来源证据"
        title="这篇内容的主要来源与上下文"
        titleClassName="!text-[1.55rem]"
        description={summary || '这里会展示来源摘要、主要引用入口，以及这篇文章归属到哪条主题或系列。'}
      />

      <div className="mt-5 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {primarySource?.source_name ? <span>主要来源：{primarySource.source_name}</span> : null}
        {post?.coverage_date ? <span>覆盖日期：{post.coverage_date}</span> : null}
        {post?.topic_key ? <span>相关主题：{post.topic_key}</span> : null}
        {post?.series_slug ? <span>所属系列：{getSeriesTitle({ slug: post.series_slug })}</span> : null}
      </div>

      {sources.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {sources.slice(0, 6).map((source, index) => (
            <a
              key={`${source.source_url || source.source_name || 'source'}-${index}`}
              href={source.source_url || '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              {source.source_name || source.source_type || '来源'}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function InsightMetric({ label, score, summary }) {
  const numeric = Number(score)
  const tone =
    Number.isFinite(numeric) && numeric >= 85
      ? { bg: 'rgba(16,185,129,0.12)', text: '#047857' }
      : Number.isFinite(numeric) && numeric >= 70
        ? { bg: 'rgba(14,165,233,0.12)', text: '#0369A1' }
        : { bg: 'rgba(245,158,11,0.12)', text: '#B45309' }

  return (
    <div className="rounded-[1.4rem] border px-4 py-4" style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)' }}>
      <div className="text-xs font-semibold" style={{ color: 'var(--text-faint)' }}>{label}</div>
      <div className="mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold" style={{ backgroundColor: tone.bg, color: tone.text }}>
        {Number.isFinite(numeric) ? `${numeric} / 100` : '待补齐'}
      </div>
      <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{summary}</p>
    </div>
  )
}

function QualityInsightsSection({ post }) {
  const insight = post?.quality_insights
  if (!insight) return null

  return (
    <section className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <EditorialSectionHeader
            eyebrow="质量洞察"
            title="这篇文章的结构和完成度"
            titleClassName="!text-[1.55rem]"
            description={insight.followup_summary}
          />
          {!insight.has_snapshot ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
              当前为基于公开元数据生成的只读摘要，不会改动正文内容。
            </p>
          ) : null}
        </div>
        <div className="rounded-[1.4rem] px-4 py-3" style={{ backgroundColor: 'var(--accent-soft)' }}>
          <div className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>综合质量</div>
          <div className="mt-1 text-2xl font-semibold" style={{ color: 'var(--accent)' }}>{insight.overall_score ?? '-'}</div>
          <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
            {insight.followup_recommended ? '值得继续追踪' : '继续观察'}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {insight.source_count ? <span>来源数：{insight.source_count}</span> : null}
        {insight.reading_time ? <span>阅读时长：{insight.reading_time} 分钟</span> : null}
        {post?.series_slug ? <span>系列：{post.series_slug}</span> : null}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <InsightMetric label="结构维度" score={insight.structure_score} summary={insight.structure_summary} />
        <InsightMetric label="来源维度" score={insight.source_score} summary={insight.source_summary} />
        <InsightMetric label="分析维度" score={insight.analysis_score} summary={insight.analysis_summary} />
      </div>

      {insight.snapshot_notes ? (
        <div className="mt-5 rounded-[1.4rem] border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)', borderColor: 'var(--border-muted)' }}>
          {insight.snapshot_notes}
        </div>
      ) : null}
    </section>
  )
}

function TopicTrackingSection({ post }) {
  const topicKey = String(post?.topic_key || '').trim()
  const seriesSlug = String(post?.series_slug || '').trim()
  const seriesTitle = seriesSlug ? getSeriesTitle({ slug: seriesSlug }) : ''
  if (!topicKey && !seriesSlug) return null

  return (
    <section className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-8">
      <EditorialSectionHeader
        eyebrow="读完之后"
        title="把这篇文章变成持续追踪的入口"
        titleClassName="!text-[1.55rem]"
        description="如果这篇文章正好命中了你关心的方向，可以继续追踪对应主题、保存订阅偏好，或者回到所属系列沿阅读路径继续往下看。"
      />

      <div className="mt-5 flex flex-wrap gap-3">
        {topicKey ? (
          <FollowTopicButton
            topic={{
              topic_key: topicKey,
              display_title: topicKey,
              description: post?.summary || '',
            }}
          />
        ) : null}
        {topicKey ? (
          <Link
            to={`/topics/${topicKey}`}
            className="inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            进入主题页
          </Link>
        ) : null}
        {topicKey ? (
          <Link
            to={buildSubscriptionCenterHref({ topicKey, contentType: post?.content_type })}
            className="inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold"
            style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
          >
            订阅相关更新
          </Link>
        ) : null}
        {seriesSlug ? (
          <Link
            to={`/series/${seriesSlug}`}
            className="inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold"
            style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
          >
            回到系列：{seriesTitle}
          </Link>
        ) : null}
      </div>
    </section>
  )
}

export default function PostDetailPage({ slug: overrideSlug }) {
  const { settings } = useSite()
  const params = useParams()
  const slug = overrideSlug ?? params.slug
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copiedCode, setCopiedCode] = useState('')
  const [likeCount, setLikeCount] = useState(0)
  const [liked, setLiked] = useState(false)
  const [relatedPosts, setRelatedPosts] = useState([])
  const [sameSeriesPosts, setSameSeriesPosts] = useState([])
  const [sameTopicPosts, setSameTopicPosts] = useState([])
  const [sameWeekPosts, setSameWeekPosts] = useState([])
  const { scrollYProgress } = useScroll()
  const progressScaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.2,
  })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setRelatedPosts([])
    setSameSeriesPosts([])
    setSameTopicPosts([])
    setSameWeekPosts([])

    fetchPostDetail(
      slug,
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 15000, staleTtl: 90000 },
    )
      .then((data) => {
        if (controller.signal.aborted) return
        setPost(data)
        setLikeCount(data.like_count || 0)
        setLiked(localStorage.getItem(`liked_${slug}`) === '1')
        setSameSeriesPosts(Array.isArray(data.same_series_posts) ? data.same_series_posts : [])
        setSameTopicPosts(Array.isArray(data.same_topic_posts) ? data.same_topic_posts : [])
        setSameWeekPosts(Array.isArray(data.same_week_posts) ? data.same_week_posts : [])
        recordReadingHistory({
          slug: data.slug,
          title: data.title,
          summary: data.summary,
          topic_key: data.topic_key,
          content_type: data.content_type,
          coverage_date: data.coverage_date,
        })
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setError('文章不存在或加载失败。')
        setLoading(false)
      })

    return () => controller.abort()
  }, [slug])

  useEffect(() => {
    if (!post?.slug) return

    const controller = new AbortController()
    fetchRelatedPosts(
      post.slug,
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 15000, staleTtl: 90000 },
    )
      .then((data) => {
        if (controller.signal.aborted) return
        setRelatedPosts(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setRelatedPosts([])
      })

    return () => controller.abort()
  }, [post?.slug])

  useEffect(() => {
    if (post) document.title = `${post.title} - AI 资讯观察`
  }, [post])

  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])

  const readingTime = useMemo(() => {
    return post ? calcReadingTime(post.content_md) : 0
  }, [post])
  const detailJsonLd = useMemo(() => {
    if (!post) return []
    return [
      buildArticleJsonLd({
        siteUrl,
        title: post.title,
        description: post.summary,
        path: `/posts/${post.slug}`,
        image: post.cover_image || '',
        datePublished: post.created_at,
        dateModified: post.updated_at || post.created_at,
        publisherName: 'AI 资讯观察',
      }),
      buildBreadcrumbJsonLd({
        siteUrl,
        items: [
          { name: '首页', path: '/' },
          { name: post.title, path: `/posts/${post.slug}` },
        ],
      }),
    ]
  }, [post, siteUrl])

  async function handleCopy(code) {
    await navigator.clipboard.writeText(code)
    setCopiedCode(code)
    window.setTimeout(() => {
      setCopiedCode((current) => (current === code ? '' : current))
    }, 1500)
  }

  async function handleLike() {
    if (liked) return
    try {
      const result = await likePost(slug)
      setLikeCount(result?.like_count ?? likeCount + 1)
      setLiked(true)
      localStorage.setItem(`liked_${slug}`, '1')
    } catch {
      setLikeCount((c) => c + 1)
      setLiked(true)
      localStorage.setItem(`liked_${slug}`, '1')
    }
  }

  function prefetchPost(slugToPrefetch) {
    prefetchPostDetail(slugToPrefetch, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  if (loading) {
    return (
      <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <Navbar />
        <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 lg:px-20">
          <div className="flex flex-col gap-8 lg:flex-row">
            <div className="flex-1"><ArticleSkeleton size="hero" /></div>
            <div className="lg:w-80"><div className="loading-skeleton h-64" /></div>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <Navbar />
        <div className="mx-auto max-w-7xl px-6 py-10 sm:px-10 lg:px-20">
          <div data-ui="detail-error">
            <EmptyStatePanel title="加载失败" description={error} />
          </div>
        </div>
      </main>
    )
  }

  const contentMeta = getContentTypeMeta(post?.content_type)

  return (
    <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      {post ? (
        <SeoMeta
          title={`${post.title} - AI 资讯观察`}
          description={post.summary}
          path={`/posts/${post.slug}`}
          image={post.cover_image || ''}
          jsonLd={detailJsonLd}
          rssUrl={post.topic_key ? buildPublicApiUrl(`/api/feeds/topics/${encodeURIComponent(post.topic_key)}.xml`) : ''}
        />
      ) : null}
      <motion.div
        className="fixed left-0 right-0 top-0 z-[70] h-1 origin-left"
        style={{ scaleX: progressScaleX, backgroundColor: 'var(--accent)' }}
      />
      <Navbar />

      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10 lg:px-20">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-faint)' }}>
          <ArrowLeft size={14} />
          返回首页
        </Link>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mt-6"
        >
          <CoverCard
            image={post.cover_image}
            imageAlt={post.title}
            overlay
            eyebrow={contentMeta?.label || '文章'}
            badge={post.is_pinned ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: 'linear-gradient(135deg, #FEF3C7 0%, #FBBF24 100%)', color: '#78350F' }}
              >
                <Pin size={12} />
                编辑推荐
              </span>
            ) : null}
            title={post.title}
            description={post.summary}
            meta={[
              formatDate(post.created_at),
              post.coverage_date ? `覆盖日期 ${post.coverage_date}` : '',
              `阅读时长 ${readingTime} 分钟`,
              `${post.view_count || 0} 次浏览`,
            ].filter(Boolean)}
          />
        </motion.section>

        <div className="mt-10 flex flex-col gap-10 lg:flex-row">
          <article data-ui="detail-article" className="min-w-0 flex-1">
            <div className="editorial-panel rounded-[1.8rem] p-6 sm:p-10">
              <Suspense fallback={<ArticleSkeleton size="content" />}>
                <ArticleMarkdownRenderer
                  markdown={post.content_md}
                  copiedCode={copiedCode}
                  onCopy={handleCopy}
                />
              </Suspense>
            </div>

            <SourceSummarySection post={post} />
            <QualityInsightsSection post={post} />
            <TopicTrackingSection post={post} />

            <div className="mt-8 flex items-center justify-center">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleLike}
                disabled={liked}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 disabled:cursor-default"
                style={{
                  backgroundColor: liked ? 'var(--danger-soft)' : 'var(--bg-surface)',
                  color: liked ? '#ef4444' : 'var(--text-secondary)',
                  border: `1px solid ${liked ? 'var(--danger-border)' : 'var(--border-muted)'}`,
                  boxShadow: 'var(--card-shadow-soft)',
                }}
              >
                <Heart size={18} fill={liked ? '#ef4444' : 'none'} />
                {liked ? '已点赞' : '点赞'} · {likeCount}
              </motion.button>
            </div>

            {post.tags?.length > 0 ? (
              <div className="mt-6 flex flex-wrap gap-2">
                {post.tags.map((t) => (
                  <Link
                    key={t.slug}
                    to={`/?tag=${t.slug}`}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-200"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    # {t.name}
                  </Link>
                ))}
              </div>
            ) : null}

            {relatedPosts.length > 0 ? (
              <div className="mt-10">
                <EditorialSectionHeader
                  eyebrow="相关阅读"
                  title="从这里继续扩展"
                  titleClassName="!text-[1.55rem]"
                  description="如果你想继续沿着相近方向阅读，可以先从这些文章接着看。"
                />
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {relatedPosts.map((rp) => (
                    <div key={rp.slug} onMouseEnter={() => prefetchPost(rp.slug)} onFocus={() => prefetchPost(rp.slug)}>
                      <CoverCard
                        to={`/posts/${rp.slug}`}
                        image={rp.cover_image}
                        imageAlt={rp.title}
                        title={rp.title}
                        description={rp.summary}
                        meta={[formatDate(rp.created_at)]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-10">
              <CommentSection slug={slug} />
            </div>
          </article>

          <div className="hidden flex-shrink-0 lg:block lg:w-[300px]">
            <div className="sticky top-24 space-y-6">
              <TableOfContents markdown={post.content_md} />
              <DetailRailSection title="同系列继续阅读" items={sameSeriesPosts} onPrefetch={prefetchPost} />
              <DetailRailSection title="同主题相关文章" items={sameTopicPosts} onPrefetch={prefetchPost} />
              <DetailRailSection title="同周上下文" items={sameWeekPosts} toPostLabel onPrefetch={prefetchPost} />
            </div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <TableOfContents markdown={post.content_md} mobile />
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
