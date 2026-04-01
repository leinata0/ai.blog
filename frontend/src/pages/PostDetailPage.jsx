import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Calendar, FolderOpen, Clock } from 'lucide-react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { fetchPostDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import ArticleSkeleton from '../components/ArticleSkeleton'

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
        setError('Post not found')
        setLoading(false)
      })

    return () => { active = false }
  }, [slug])

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
        <div className="mx-auto max-w-6xl px-6 sm:px-10 py-10">
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
        <div className="mx-auto max-w-6xl px-6 sm:px-10 py-10">
          <div data-ui="detail-error" className="rounded-2xl px-8 py-6 shadow-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)' }}>
            <span className="text-fluid-xs font-semibold" style={{ color: 'var(--text-faint)' }}>
              错误: {' '}
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
          minHeight: '400px'
        }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex-1 max-w-3xl">
            <h1 className="text-fluid-3xl font-bold tracking-tight mb-5 leading-tight" style={{ color: 'var(--text-primary)' }}>
              {post.title}
            </h1>
            <p className="text-fluid-lg mb-5" style={{ color: 'var(--text-secondary)' }}>
              {post.summary}
            </p>
            <div className="flex items-center gap-5 text-fluid-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" /> 发表于 2024-05-28</span>
              <span className="flex items-center gap-1.5"><FolderOpen size={14} className="text-gray-400" /> Docs 文档</span>
              <span className="flex items-center gap-1.5"><Clock size={14} className="text-gray-400" /> 阅读时长: 5分钟</span>
            </div>
          </div>
          <motion.div
            className="hidden lg:flex w-[280px] h-[280px] rounded-full items-center justify-center"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid var(--bg-surface)' }}
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            <span className="text-8xl">👨‍💻</span>
          </motion.div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
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
                              {copiedCode === code ? 'Copied!' : 'Copy'}
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
                        <code className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md text-sm font-mono whitespace-nowrap" {...props}>
                          {children}
                        </code>
                      )
                    },
                    h1: ({ children }) => <h1 className="text-3xl font-bold mt-8 mb-4" style={{ color: 'var(--text-primary)' }}>{children}</h1>,
                    h2: ({ children }) => <h2 className="text-2xl font-bold mt-6 mb-3" style={{ color: 'var(--text-primary)' }}>{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xl font-semibold mt-5 mb-2" style={{ color: 'var(--text-primary)' }}>{children}</h3>,
                    p: ({ children }) => <p className="my-4 leading-relaxed text-base">{children}</p>,
                    blockquote: ({ children }) => (
                      <blockquote className="my-6 rounded-r-xl border-l-4 border-blue-500 bg-blue-50 px-5 py-4 italic" style={{ color: '#64748b' }}>
                        {children}
                      </blockquote>
                    ),
                  }}
                >
                  {post.content_md}
                </ReactMarkdown>
              </div>
            </div>
          </article>

          {/* Right: Sidebar */}
          <div className="lg:w-[380px] flex-shrink-0">
            <div className="sticky top-20">
              <Sidebar />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t px-6 sm:px-10 py-6" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}>
        <span className="text-fluid-xs" style={{ color: 'var(--accent)' }}>
          [EOF]
        </span>
      </footer>
    </main>
  )
}
