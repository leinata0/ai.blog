import { useEffect, useState, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Calendar, Clock, Eye, ArrowLeft } from 'lucide-react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { fetchPostDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import TableOfContents from '../components/TableOfContents'
import CommentSection from '../components/CommentSection'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import ArticleSkeleton from '../components/ArticleSkeleton'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function calcReadingTime(text) {
  if (!text) return 1
  const charCount = text.replace(/[#*`\->\[\]()!|]/g, '').length
  return Math.max(1, Math.ceil(charCount / 500))
}

function slugifyHeading(text) {
  return text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
}

export default function PostDetailPage({ slug: overrideSlug }) {
  const params = useParams()
  const slug = overrideSlug ?? params.slug
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [copiedCode, setCopiedCode] = useState('')
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
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('文章不存在或加载失败')
        setLoading(false)
      })

    return () => { active = false }
  }, [slug])

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
                  <img src={post.cover_image} alt={post.title} className="w-full h-full object-cover" />
                </div>
              )}
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
                  }}
                >
                  {post.content_md}
                </ReactMarkdown>
              </div>
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
            </div>
          </div>
        </div>
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
