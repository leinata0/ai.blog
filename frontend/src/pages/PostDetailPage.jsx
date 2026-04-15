import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Calendar, Clock, Eye, ArrowLeft, Heart, Pin } from 'lucide-react'
import { motion, useScroll, useSpring } from 'framer-motion'

import { fetchPostDetail, likePost, fetchRelatedPosts } from '../api/posts'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
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
import { recordReadingHistory } from '../utils/topicRetention'
import { getContentTypeMeta } from '../utils/contentPresentation'

function calcReadingTime(text) {
  if (!text) return 1
  const charCount = text.replace(/[#*`\->\[\]()!|]/g, '').length
  return Math.max(1, Math.ceil(charCount / 500))
}

function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
}

function MarkdownImage({ src, alt, title }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    setVisible(true)
  }, [src])

  if (!src || !visible) return null

  return (
    <span className="not-prose my-8 block overflow-hidden rounded-[1.6rem] border" style={{ borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow-soft)' }}>
      <img
        src={proxyImageUrl(src)}
        alt={typeof alt === 'string' ? alt : ''}
        title={title}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="block h-auto w-full object-cover"
        onError={() => setVisible(false)}
      />
    </span>
  )
}

function DetailRailSection({ title, items, toPostLabel = false }) {
  if (!items || items.length === 0) return null

  return (
    <section className="editorial-panel rounded-[1.8rem] p-5">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link
            key={item.slug}
            to={`/posts/${item.slug}`}
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

  return (
    <section className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-8">
      <EditorialSectionHeader
        eyebrow="来源摘要"
        title="这篇内容参考了哪些信息"
        titleClassName="!text-[1.55rem]"
        description={summary || '这里会展示来源摘要和主要引用入口。'}
      />

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
  if (!topicKey) return null

  return (
    <section className="mt-8 editorial-panel rounded-[1.8rem] p-6 sm:p-8">
      <EditorialSectionHeader
        eyebrow="继续追踪这条主线"
        title="回到主题页，继续看同一条主线"
        titleClassName="!text-[1.55rem]"
        description={`这篇文章归属于主题 ${topicKey}。如果你想持续看这条主线后续怎么发展，可以直接进入主题页或订阅主题 RSS。`}
      />

      <div className="mt-5 flex flex-wrap gap-3">
        <FollowTopicButton
          topic={{
            topic_key: topicKey,
            display_title: topicKey,
            description: post?.summary || '',
          }}
        />
        <Link
          to={`/topics/${topicKey}`}
          className="inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold"
          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          进入主题页
        </Link>
        <a
          href={`/api/feeds/topics/${encodeURIComponent(topicKey)}.xml`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-full px-4 py-3 text-sm font-semibold"
          style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
        >
          订阅主题 RSS
        </a>
      </div>
    </section>
  )
}

export default function PostDetailPage({ slug: overrideSlug }) {
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
    let active = true
    setLoading(true)
    setError('')

    fetchPostDetail(slug)
      .then((data) => {
        if (!active) return
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
      .catch(() => {
        if (!active) return
        setError('文章不存在或加载失败。')
        setLoading(false)
      })

    fetchRelatedPosts(slug)
      .then((data) => { if (active) setRelatedPosts(Array.isArray(data) ? data : []) })
      .catch(() => {})

    return () => { active = false }
  }, [slug])

  useEffect(() => {
    if (post) document.title = `${post.title} - AI 资讯观察`
  }, [post])

  const readingTime = useMemo(() => {
    return post ? calcReadingTime(post.content_md) : 0
  }, [post])

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
              <div className="prose max-w-none" style={{ color: 'var(--text-secondary)' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre({ children }) {
                      return <div className="not-prose my-6 overflow-hidden rounded-[1.2rem] shadow-lg ring-1 ring-slate-800/60">{children}</div>
                    },
                    code({ inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const code = String(children).replace(/\n$/, '')
                      if (!inline && match) {
                        return (
                          <div className="group relative my-4">
                            <button
                              type="button"
                              onClick={() => handleCopy(code)}
                              className="absolute right-3 top-3 z-10 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                            >
                              {copiedCode === code ? '已复制' : '复制'}
                            </button>
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              className="my-0 rounded-[1.2rem]"
                              {...props}
                            >
                              {code}
                            </SyntaxHighlighter>
                          </div>
                        )
                      }
                      return (
                        <code
                          className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-sm font-mono"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    },
                    h1: ({ children }) => {
                      const text = String(children)
                      return <h1 id={slugifyHeading(text)} className="font-display text-4xl font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{children}</h1>
                    },
                    h2: ({ children }) => {
                      const text = String(children)
                      return <h2 id={slugifyHeading(text)} className="mt-10 font-display text-[2rem] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{children}</h2>
                    },
                    h3: ({ children }) => {
                      const text = String(children)
                      return <h3 id={slugifyHeading(text)} className="mt-8 font-display text-[1.45rem] font-semibold tracking-[-0.02em]" style={{ color: 'var(--text-primary)' }}>{children}</h3>
                    },
                    p: ({ children }) => <p className="my-5 text-base leading-8">{children}</p>,
                    blockquote: ({ children }) => (
                      <blockquote
                        className="my-8 rounded-r-[1.2rem] border-l-4 px-5 py-4 italic"
                        style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-soft)', color: 'var(--text-secondary)' }}
                      >
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className="my-6 overflow-x-auto rounded-[1.2rem] border" style={{ borderColor: 'var(--border-muted)' }}>
                        <table className="w-full text-sm">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="px-4 py-2.5 text-left text-sm font-semibold" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-muted)' }}>
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="px-4 py-2.5 text-sm" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                        {children}
                      </td>
                    ),
                    img: MarkdownImage,
                  }}
                >
                  {post.content_md}
                </ReactMarkdown>
              </div>
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
                    <CoverCard
                      key={rp.slug}
                      to={`/posts/${rp.slug}`}
                      image={rp.cover_image}
                      imageAlt={rp.title}
                      title={rp.title}
                      description={rp.summary}
                      meta={[formatDate(rp.created_at)]}
                    />
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
              <DetailRailSection title="同系列继续阅读" items={sameSeriesPosts} />
              <DetailRailSection title="同主题相关文章" items={sameTopicPosts} />
              <DetailRailSection title="同周上下文" items={sameWeekPosts} toPostLabel />
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
