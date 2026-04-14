import { useEffect, useState, useMemo } from 'react'
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
    <span className="not-prose block my-6 rounded-2xl bg-gradient-to-br from-slate-900/5 to-slate-900/0 p-1 shadow-sm">
      <span className="block overflow-hidden rounded-xl border border-white/10 bg-transparent">
        <img
          src={proxyImageUrl(src)}
          alt={typeof alt === 'string' ? alt : ''}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="block w-full h-auto object-cover"
          onError={() => setVisible(false)}
        />
      </span>
    </span>
  )
}

const CONTENT_TYPE_META = {
  daily_brief: {
    label: '日更快报',
    accent: 'var(--accent)',
    background: 'var(--accent-soft)',
  },
  weekly_review: {
    label: '每周回顾',
    accent: '#2563eb',
    background: 'rgba(37,99,235,0.12)',
  },
}

function DetailRailSection({ title, items, toPostLabel = false }) {
  if (!items || items.length === 0) return null
  return (
    <section className="rounded-2xl p-5" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link
            key={item.slug}
            to={`/posts/${item.slug}`}
            className="block rounded-2xl px-4 py-3 transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
          >
            {toPostLabel && item.content_type ? (
              <div className="mb-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>{item.content_type}</div>
            ) : null}
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
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
    <section className="mt-8 rounded-xl p-6 sm:p-8" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
      <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>来源摘要</h3>
      {summary ? (
        <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{summary}</p>
      ) : null}
      {sources.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {sources.slice(0, 6).map((source, index) => (
            <a
              key={`${source.source_url || source.source_name || 'source'}-${index}`}
              href={source.source_url || '#'}
              target="_blank"
              rel="noreferrer"
              className="rounded-full px-3 py-1 text-xs font-medium"
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
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('文章不存在或加载失败')
        setLoading(false)
      })

    fetchRelatedPosts(slug)
      .then((data) => { if (active) setRelatedPosts(Array.isArray(data) ? data : []) })
      .catch(() => {})

    return () => { active = false }
  }, [slug])

  useEffect(() => {
    if (post) document.title = post.title + ' - 极客开发日志'
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
        <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 py-10">
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="flex-1"><ArticleSkeleton size="hero" /></div>
            <div className="lg:w-80"><div className="h-64 rounded-lg skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} /></div>
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <Navbar />
        <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 py-10">
          <div data-ui="detail-error" className="rounded-2xl px-8 py-6 shadow-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)' }}>
            <span className="text-fluid-xs font-semibold" style={{ color: 'var(--text-faint)' }}>
              错误:{' '}
            </span>
            {error}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 origin-left"
        style={{ scaleX: progressScaleX, backgroundColor: '#38bdf8', zIndex: 70 }}
      />
      <Navbar />

      {/* Hero Banner */}
      <div
        className="relative px-6 sm:px-10 lg:px-20 py-16 sm:py-24"
        style={{
          background: 'linear-gradient(to bottom, var(--bg-canvas-deep), var(--border-strong))',
          minHeight: '340px'
        }}
      >
        <div className="mx-auto max-w-7xl">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm mb-6 transition-colors duration-200"
            style={{ color: 'var(--text-faint)' }}
          >
            <ArrowLeft size={14} /> 返回首页
          </Link>

          <div className="flex items-center justify-between">
            <div className="flex-1 max-w-3xl">
              {post.cover_image && (
                <div className="w-full h-56 rounded-xl overflow-hidden mb-6">
                  <img src={proxyImageUrl(post.cover_image)} alt={post.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.target.parentElement.style.display = 'none' }} />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                {post.content_type && CONTENT_TYPE_META[post.content_type] && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-sm"
                    style={{
                      background: CONTENT_TYPE_META[post.content_type].background,
                      color: CONTENT_TYPE_META[post.content_type].accent,
                      border: '1px solid rgba(255,255,255,0.2)',
                    }}
                  >
                    {CONTENT_TYPE_META[post.content_type].label}
                  </span>
                )}
                {post.is_pinned && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shadow-sm"
                    style={{
                      background: 'linear-gradient(135deg, #FEF3C7 0%, #FBBF24 100%)',
                      color: '#78350F',
                      border: '1px solid rgba(180,83,9,0.35)',
                    }}
                  >
                    <Pin size={13} style={{ transform: 'rotate(-12deg)' }} />
                    置顶推荐
                  </motion.span>
                )}
              </div>
              <h1 className="text-fluid-3xl font-bold tracking-tight mb-5 leading-tight" style={{ color: 'var(--text-primary)' }}>
                {post.title}
              </h1>
              <p className="text-fluid-lg mb-5" style={{ color: 'var(--text-secondary)' }}>
                {post.summary}
              </p>
              <div className="flex items-center flex-wrap gap-5 text-fluid-xs" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1.5">
                  <Calendar size={14} style={{ color: 'var(--text-faint)' }} /> {formatDate(post.created_at)}
                </span>
                {post.coverage_date && (
                  <span className="flex items-center gap-1.5">
                    <Calendar size={14} style={{ color: 'var(--text-faint)' }} /> 覆盖日期: {post.coverage_date}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Clock size={14} style={{ color: 'var(--text-faint)' }} /> 阅读时长: {readingTime} 分钟
                </span>
                <span className="flex items-center gap-1.5">
                  <Eye size={14} style={{ color: 'var(--text-faint)' }} /> {post.view_count || 0} 次浏览
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content + TOC Layout */}
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 py-12">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* Left: Article Content */}
          <article data-ui="detail-article" className="flex-1 min-w-0">
            <div
              className="rounded-xl p-6 sm:p-10 transition-all duration-300"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <div
                className="prose max-w-none"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    pre({ children }) {
                      return <div className="not-prose my-6 overflow-hidden rounded-xl shadow-lg ring-1 ring-slate-800/60">{children}</div>
                    },
                    code({ node, inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      const code = String(children).replace(/\n$/, '')
                      if (!inline && match) {
                        return (
                          <div className="relative group my-4">
                            <button
                              type="button"
                              onClick={() => handleCopy(code)}
                              className="absolute right-3 top-3 z-10 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                            >
                              {copiedCode === code ? '已复制!' : '复制'}
                            </button>
                            <SyntaxHighlighter
                              style={vscDarkPlus}
                              language={match[1]}
                              PreTag="div"
                              className="rounded-xl my-0"
                              {...props}
                            >
                              {code}
                            </SyntaxHighlighter>
                          </div>
                        )
                      }
                      return (
                        <code
                          className="px-1.5 py-0.5 rounded-md text-sm font-mono whitespace-nowrap"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                          {...props}
                        >
                          {children}
                        </code>
                      )
                    },
                    h1: ({ children }) => {
                      const text = String(children)
                      return <h1 id={slugifyHeading(text)} className="text-3xl font-bold mt-8 mb-4" style={{ color: 'var(--text-primary)' }}>{children}</h1>
                    },
                    h2: ({ children }) => {
                      const text = String(children)
                      return <h2 id={slugifyHeading(text)} className="text-2xl font-bold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>{children}</h2>
                    },
                    h3: ({ children }) => {
                      const text = String(children)
                      return <h3 id={slugifyHeading(text)} className="text-xl font-semibold mt-5 mb-2" style={{ color: 'var(--text-primary)' }}>{children}</h3>
                    },
                    p: ({ children }) => <p className="my-4 leading-relaxed text-base">{children}</p>,
                    blockquote: ({ children }) => (
                      <blockquote
                        className="my-6 rounded-r-xl border-l-4 px-5 py-4 italic"
                        style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--accent-soft)', color: 'var(--text-secondary)' }}
                      >
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className="my-6 overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border-muted)' }}>
                        <table className="w-full text-sm">{children}</table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="px-4 py-2.5 text-left font-semibold text-sm" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-muted)' }}>
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

            {/* 点赞按钮 */}
            <div className="flex items-center justify-center mt-8">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={handleLike}
                disabled={liked}
                className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium transition-all duration-200 disabled:cursor-default"
                style={{
                  backgroundColor: liked ? 'var(--danger-soft)' : 'var(--bg-surface)',
                  color: liked ? '#ef4444' : 'var(--text-secondary)',
                  border: `1px solid ${liked ? 'var(--danger-border)' : 'var(--border-muted)'}`,
                  boxShadow: 'var(--card-shadow)',
                }}
              >
                <Heart size={18} fill={liked ? '#ef4444' : 'none'} />
                {liked ? '已点赞' : '点赞'} · {likeCount}
              </motion.button>
            </div>

            {/* 标签 */}
            {post.tags?.length > 0 && (
              <div className="flex items-center flex-wrap gap-2 mt-6">
                {post.tags.map((t) => (
                  <Link
                    key={t.slug}
                    to={`/?tag=${t.slug}`}
                    className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors duration-200"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    # {t.name}
                  </Link>
                ))}
              </div>
            )}

            {/* 相关文章 */}
            {relatedPosts.length > 0 && (
              <div className="mt-10">
                <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>相关文章</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {relatedPosts.map((rp) => (
                    <Link
                      key={rp.slug}
                      to={`/posts/${rp.slug}`}
                      className="rounded-xl p-5 transition-all duration-200 hover:shadow-md"
                      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                    >
                      {rp.cover_image && (
                        <div className="w-full h-32 rounded-lg overflow-hidden mb-3">
                          <img src={proxyImageUrl(rp.cover_image)} alt={rp.title} className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                        </div>
                      )}
                      <h4 className="font-medium text-sm mb-1 line-clamp-2" style={{ color: 'var(--text-primary)' }}>{rp.title}</h4>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(rp.created_at)}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 评论区 */}
            <div
              className="rounded-xl p-6 sm:p-10 mt-8"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <CommentSection slug={slug} />
            </div>
          </article>

          {/* Right: TOC */}
          <div className="lg:w-[300px] flex-shrink-0 hidden lg:block">
            <div className="sticky top-20 space-y-6">
              <TableOfContents markdown={post.content_md} />
              <DetailRailSection title="同系列继续阅读" items={sameSeriesPosts} />
              <DetailRailSection title="同主题相关文章" items={sameTopicPosts} />
              <DetailRailSection title="同周上下文" items={sameWeekPosts} toPostLabel />
            </div>
          </div>
        </div>
      </div>

      {/* 移动端目录 */}
      <div className="lg:hidden">
        <TableOfContents markdown={post.content_md} mobile />
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
