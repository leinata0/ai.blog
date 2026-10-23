import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Heart, Pin } from 'lucide-react'
import { motion, useScroll, useSpring } from 'framer-motion'

import { fetchPostDetail, likePost, fetchLikeState, fetchRelatedPosts, prefetchPostDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import Navbar from '../components/Navbar'
import TableOfContents from '../components/TableOfContents'
import CommentSection from '../components/CommentSection'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import ArticleSkeleton from '../components/ArticleSkeleton'
import FollowTopicButton from '../components/FollowTopicButton'
import EmptyStatePanel from '../components/EmptyStatePanel'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { recordHistory as recordHistorySync } from '../utils/topicSync'
import { useUser } from '../contexts/UserContext'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { buildSubscriptionCenterHref } from '../utils/subscriptionLinks'
import { proxyImageUrl } from '../utils/proxyImage'
import '../styles/news-reading.css'
import '../styles/news-tech-reading.css'
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

function ArticleCover({ post, contentLabel }) {
  const [unavailable, setUnavailable] = useState(false)
  return <figure className="news-article__cover">
    {unavailable ? <div className="news-article__image-unavailable">报道配图暂不可用</div> : <img
      src={proxyImageUrl(post.cover_image)} alt={post.title} width="1200" height="675" loading="eager"
      onError={() => setUnavailable(true)}
    />}
    <figcaption>报道配图 · {contentLabel || '新闻观察'}</figcaption>
  </figure>
}

function readableSourceSummary(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return ''
  try {
    // Older artifacts sometimes expose the complete planning JSON here.
    const parsed = JSON.parse(text)
    const summary = typeof parsed?.summary === 'string' && !parsed.summary.includes('[object Object]')
      ? parsed.summary : (typeof parsed?.description === 'string' ? parsed.description : '')
    return summary.includes('[object Object]') ? '' : summary
  } catch {
    return text.includes('[object Object]') ? '' : text
  }
}

function sourceHref(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch {
    return ''
  }
}

function DetailRailSection({ title, items, toPostLabel = false, onPrefetch }) {
  if (!items || items.length === 0) return null

  return (
    <section className="news-article__rail-section">
      <h3>{title}</h3>
      <div>
        {items.map((item) => (
          <Link
            key={item.slug}
            to={`/posts/${item.slug}`}
            onMouseEnter={() => onPrefetch?.(item.slug)}
            onFocus={() => onPrefetch?.(item.slug)}
            className="news-article__rail-link"
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
  const summary = readableSourceSummary(post?.source_summary)
  if (!summary && sources.length === 0) return null
  const primarySource = sources.find((item) => item.is_primary) || sources[0] || null

  return (
    <section className="news-article__evidence" aria-labelledby="article-sources-title">
      <p className="news-article__kicker">来源证据</p>
      <h2 id="article-sources-title">参考来源与报道背景</h2>
      {summary ? <p className="news-article__section-copy">{summary}</p> : null}

      <div className="mt-5 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {primarySource?.source_name ? <span>主要来源：{primarySource.source_name}</span> : null}
        {post?.coverage_date ? <span>覆盖日期：{post.coverage_date}</span> : null}
        {post?.topic_key ? <Link to={`/topics/${post.topic_key}`}>查看相关主题 ↗</Link> : null}
        {post?.series_slug ? <span>所属系列：{getSeriesTitle({ slug: post.series_slug })}</span> : null}
      </div>

      {sources.length > 0 ? (
        <ol className="news-article__sources">
          {sources.map((source, index) => (
            <li key={`${source.source_url || source.source_name || 'source'}-${index}`}>
            {sourceHref(source.source_url) ? <a
              href={sourceHref(source.source_url)}
              target="_blank"
              rel="noreferrer"
            >
              <span>{source.source_name || source.source_type || '来源'}</span>
              <span aria-hidden="true">↗</span>
            </a> : <span>{source.source_name || source.source_type || '来源'} <small>原始链接暂不可用</small></span>}
            {source.title ? <p>{source.title}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function InsightMetric({ label, score, summary }) {
  const numeric = score === null || score === undefined || score === '' ? NaN : Number(score)
  return (
    <div className="news-article__metric">
      <div>{label}</div>
      <strong>
        {Number.isFinite(numeric) ? `${numeric} / 100` : '待补齐'}
      </strong>
      <p>{summary}</p>
    </div>
  )
}

function QualityInsightsSection({ post }) {
  const insight = post?.quality_insights
  if (!insight) return null

  return (
    <details className="news-article__quality">
      <summary>质量洞察 · 自动结构检查 <span>{insight.overall_score ?? '-'} / 100</span><small>非事实审校</small></summary>
      <p className="news-article__quality-note">分数来自自动结构检查，不代表事实审校。请结合原始来源核对报道中的事实与判断。</p>
      <div className="news-article__quality-heading">
        <div>
          <h2>这篇文章的结构和完成度</h2>
          {insight.followup_summary ? <p className="news-article__section-copy">{insight.followup_summary}</p> : null}
          {!insight.has_snapshot ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
              当前为基于公开元数据生成的只读摘要，不会改动正文内容。
            </p>
          ) : null}
        </div>
        <div>
          <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {insight.followup_recommended ? '值得继续追踪' : '继续观察'}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {insight.source_count ? <span>来源数：{insight.source_count}</span> : null}
        {insight.reading_time ? <span>阅读时长：{insight.reading_time} 分钟</span> : null}
        {post?.series_slug ? <span>系列：{post.series_slug}</span> : null}
      </div>

      <div className="news-article__metrics">
        <InsightMetric label="结构维度" score={insight.structure_score} summary={insight.structure_summary} />
        <InsightMetric label="来源维度" score={insight.source_score} summary={insight.source_summary} />
        <InsightMetric label="分析维度" score={insight.analysis_score} summary={insight.analysis_summary} />
      </div>

      {insight.snapshot_notes ? (
        <div className="news-article__section-copy">
          {insight.snapshot_notes}
        </div>
      ) : null}
    </details>
  )
}

function TopicTrackingSection({ post }) {
  const topicKey = String(post?.topic_key || '').trim()
  const seriesSlug = String(post?.series_slug || '').trim()
  const seriesTitle = seriesSlug ? getSeriesTitle({ slug: seriesSlug }) : ''
  if (!topicKey && !seriesSlug) return null

  return (
    <section className="news-article__tracking">
      <p className="news-article__kicker">跟进报道</p>
      <h2>继续追踪这条新闻</h2>

      <div className="news-article__tracking-actions">
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
            className="news-article__text-link"
          >
            进入主题页
          </Link>
        ) : null}
        {topicKey ? (
          <Link
            to={buildSubscriptionCenterHref({ topicKey, contentType: post?.content_type })}
            className="news-article__text-link"
          >
            订阅相关更新
          </Link>
        ) : null}
        {seriesSlug ? (
          <Link
            to={`/series/${seriesSlug}`}
            className="news-article__text-link"
          >
            回到系列：{seriesTitle}
          </Link>
        ) : null}
      </div>
    </section>
  )
}

function ReadingPathNavigation({ previousPost, nextPost, onPrefetch }) {
  if (!previousPost && !nextPost) return null

  return (
    <nav className="reading-path" aria-label="上下篇文章">
      {previousPost ? (
        <Link
          to={`/posts/${previousPost.slug}`}
          onMouseEnter={() => onPrefetch(previousPost.slug)}
          onFocus={() => onPrefetch(previousPost.slug)}
          className="reading-path__item reading-path__item--previous"
        >
          <span><ArrowLeft size={14} aria-hidden="true" /> 系列延伸</span>
          <strong>{previousPost.title}</strong>
        </Link>
      ) : <span />}
      {nextPost ? (
        <Link
          to={`/posts/${nextPost.slug}`}
          onMouseEnter={() => onPrefetch(nextPost.slug)}
          onFocus={() => onPrefetch(nextPost.slug)}
          className="reading-path__item reading-path__item--next"
        >
          <span>主题延伸 <ArrowRight size={14} aria-hidden="true" /></span>
          <strong>{nextPost.title}</strong>
        </Link>
      ) : null}
    </nav>
  )
}

export default function PostDetailPage({ slug: overrideSlug }) {
  const { settings } = useSite()
  const { user } = useUser()
  const params = useParams()
  const location = useLocation()
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
  const [interactionMessage, setInteractionMessage] = useState('')
  const { scrollYProgress } = useScroll()
  const progressScaleX = useSpring(scrollYProgress, {
    stiffness: 140,
    damping: 30,
    mass: 0.2,
  })

  useEffect(() => {
    if (location.hash) return
    if (import.meta.env.MODE === 'test') return
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [slug, location.hash])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
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
        // Logged-in users get account-based liked state from the server;
        // anonymous users fall back to the per-browser localStorage marker.
        if (user) {
          // Read path must carry the same visitor token as the write path (likePost),
          // otherwise the server answers `liked: false` for everyone and the next tap
          // sends an *un*like for a like the reader never saw.
          fetchLikeState(slug, { auth: 'user' })
            .then((state) => {
              if (controller.signal.aborted) return
              setLiked(Boolean(state?.liked))
              if (typeof state?.like_count === 'number') setLikeCount(state.like_count)
            })
            .catch(() => {})
        } else {
          setLiked(localStorage.getItem(`liked_${slug}`) === '1')
        }
        setSameSeriesPosts(Array.isArray(data.same_series_posts) ? data.same_series_posts : [])
        setSameTopicPosts(Array.isArray(data.same_topic_posts) ? data.same_topic_posts : [])
        setSameWeekPosts(Array.isArray(data.same_week_posts) ? data.same_week_posts : [])
        recordHistorySync(user, {
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
    // user?.id (not `user`) — UserContext hands back a new object on every refresh,
    // and an identity change is the only thing this effect actually cares about.
  }, [slug, user?.id])

  useEffect(() => {
    if (!post?.slug) {
      setRelatedPosts([])
      return undefined
    }

    // Reset lives here, next to its own fetch. When it lived in the detail effect
    // (which also depends on `user`), a late /api/me response cleared the list while
    // post.slug stayed the same, so this effect never re-ran and 相关阅读 vanished.
    setRelatedPosts([])
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

  // Stable identity so the markdown renderer is not re-rendered by every parent update.
  const handleCopy = useCallback(async (code) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      window.setTimeout(() => {
        setCopiedCode((current) => (current === code ? '' : current))
      }, 1500)
    } catch {
      // Clipboard access can be denied (insecure context or rejected permission).
      // Swallow it so it doesn't surface as an unhandled rejection; the button simply
      // stays in its default "复制" state rather than falsely showing "已复制".
      setCopiedCode((current) => (current === code ? '' : current))
    }
  }, [])

  async function handleLike() {
    // Logged-in users can toggle (like / unlike); the server returns the
    // authoritative count and liked flag.
    if (user) {
      const prevLiked = liked
      const optimistic = !prevLiked
      setLiked(optimistic)
      setLikeCount((c) => Math.max(0, c + (optimistic ? 1 : -1)))
      try {
        const result = await likePost(slug, { auth: 'user' })
        if (typeof result?.like_count === 'number') setLikeCount(result.like_count)
        if (typeof result?.liked === 'boolean') setLiked(result.liked)
        setInteractionMessage(optimistic ? '已加入你的点赞。' : '已取消点赞。')
      } catch {
        setLiked(prevLiked)
        setLikeCount((c) => Math.max(0, c + (optimistic ? -1 : 1)))
        setInteractionMessage('点赞未保存，请检查网络后重试。')
      }
      return
    }

    // Anonymous: one-shot like, not cancellable.
    if (liked) return
    // Optimistic update: bump immediately, then roll back if the request fails.
    // Previously a failure was swallowed and treated as success, which left the UI
    // showing a like that the backend never recorded (and permanently disabled the
    // button via localStorage).
    setLiked(true)
    setLikeCount((c) => c + 1)
    try {
      const result = await likePost(slug)
      if (typeof result?.like_count === 'number') {
        setLikeCount(result.like_count)
      }
      localStorage.setItem(`liked_${slug}`, '1')
      setInteractionMessage('已加入你的点赞。')
    } catch {
      setLiked(false)
      setLikeCount((c) => Math.max(0, c - 1))
      setInteractionMessage('点赞未保存，请检查网络后重试。')
    }
  }

  function prefetchPost(slugToPrefetch) {
    prefetchPostDetail(slugToPrefetch, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  if (loading) {
    return (
      <main data-ui="detail-shell" className="news-article min-h-screen">
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
      <main data-ui="detail-shell" className="news-article min-h-screen">
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
    <main data-ui="detail-shell" className="news-article min-h-screen">
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
        aria-hidden="true"
      />
      <div className="sr-only" aria-live="polite">
        文章阅读进度条
      </div>
      <Navbar />

      <div className="news-article__wrap">
        <Link to="/" className="news-article__back">
          <ArrowLeft size={14} />
          返回首页
        </Link>

        <header className="news-article__headline">
          <div className="news-article__edition">
            <span>{contentMeta?.label || '新闻观察'}</span>
            {post.is_pinned ? <span><Pin size={12} aria-hidden="true" />编辑推荐</span> : null}
          </div>
          <h1>{post.title}</h1>
          {post.summary ? <p className="news-article__standfirst">{post.summary}</p> : null}
          <div className="news-article__byline">
            <span>AI 资讯观察</span>
            {post.created_at ? <span>发布 <time dateTime={post.created_at}>{formatDate(post.created_at)}</time></span> : null}
            {post.coverage_date ? <span>覆盖 <time dateTime={post.coverage_date}>{post.coverage_date}</time></span> : null}
            <span>{readingTime} 分钟阅读</span>
            <span>{post.view_count || 0} 次浏览</span>
            {post.sources?.length || post.source_count ? post.sources?.length || post.source_summary
              ? <a href="#article-sources-title">{post.sources?.length || post.source_count} 个来源 ↗</a>
              : <span>{post.source_count} 个来源</span> : null}
          </div>
        </header>

        <div className="news-article__layout">
          <article data-ui="detail-article" className="news-article__main">
            {post.cover_image ? <ArticleCover key={post.cover_image} post={post} contentLabel={contentMeta?.label} /> : null}
            <div className="news-article__body">
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

            <div className="news-article__interaction">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleLike}
                disabled={liked && !user}
                className="news-article__like inline-flex items-center gap-2 disabled:cursor-default"
                style={{
                  backgroundColor: liked ? 'var(--danger-soft)' : 'var(--bg-surface)',
                  color: liked ? 'var(--danger-text)' : 'var(--text-secondary)',
                  border: `1px solid ${liked ? 'var(--danger-border)' : 'var(--border-muted)'}`,
                }}
              >
                {/* fill 是 SVG 呈现属性，var() 在部分浏览器里不生效；currentColor 会继承上面的 --danger-text */}
                <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
                {liked ? '已点赞' : '点赞'} · {likeCount}
              </motion.button>
            </div>
            <div className="sr-only" role="status" aria-live="polite">{interactionMessage}</div>

            {post.tags?.length > 0 ? (
              <div className="news-article__tags">
                {post.tags.map((t) => (
                  <Link
                    key={t.slug}
                    to={`/?tag=${t.slug}`}
                    className="news-article__text-link"
                  >
                    # {t.name}
                  </Link>
                ))}
              </div>
            ) : null}

            <ReadingPathNavigation
              previousPost={sameSeriesPosts[0] || null}
              nextPost={sameTopicPosts[0] || relatedPosts[0] || null}
              onPrefetch={prefetchPost}
            />

            {relatedPosts.length > 0 ? (
              <section className="news-article__related">
                <p className="news-article__kicker">相关阅读</p>
                <h2>继续阅读</h2>
                <div>
                  {relatedPosts.map((rp) => (
                    <Link key={rp.slug} to={`/posts/${rp.slug}`} className="news-article__related-row" onMouseEnter={() => prefetchPost(rp.slug)} onFocus={() => prefetchPost(rp.slug)}>
                      <div><h3>{rp.title}</h3>{rp.summary ? <p>{rp.summary}</p> : null}<time dateTime={rp.created_at}>{formatDate(rp.created_at)}</time></div>
                      {rp.cover_image ? <img src={proxyImageUrl(rp.cover_image)} alt="" width="160" height="100" loading="lazy" /> : null}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="news-article__comments">
              <CommentSection slug={slug} />
            </section>
          </article>

          <aside className="news-article__rail hidden lg:block" aria-label="阅读目录与延伸报道">
            <div className="news-article__rail-sticky">
              <TableOfContents markdown={post.content_md} />
              <DetailRailSection title="同系列继续阅读" items={sameSeriesPosts} onPrefetch={prefetchPost} />
              <DetailRailSection title="同主题相关文章" items={sameTopicPosts} onPrefetch={prefetchPost} />
              <DetailRailSection title="同周上下文" items={sameWeekPosts} toPostLabel onPrefetch={prefetchPost} />
            </div>
          </aside>
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
