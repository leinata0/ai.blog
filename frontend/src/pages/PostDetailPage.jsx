import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
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
          <div className="rounded-2xl px-8 py-6 shadow-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)' }}>
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
    <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: '#F4F5F7' }}>
      <Navbar />

      {/* Hero Banner */}
      <div
        className="relative px-20 py-24"
        style={{
          background: 'linear-gradient(to bottom, #E8EAED, #D6D9DD)',
          minHeight: '400px'
        }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex-1 max-w-3xl">
            <h1 className="text-5xl font-bold tracking-tight mb-5 leading-tight" style={{ color: '#1A1A1A' }}>
              {post.title}
            </h1>
            <p className="text-xl mb-5" style={{ color: '#5F6368' }}>
              {post.summary}
            </p>
            <div className="flex items-center gap-5 text-sm" style={{ color: '#5F6368' }}>
              <span>📅 发表于 2024-05-28</span>
              <span>📁 Docs 文档</span>
              <span>⏱️ 阅读时长: 5分钟</span>
            </div>
          </div>
          <div className="w-[280px] h-[280px] rounded-full bg-white flex items-center justify-center" style={{ boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid #FFFFFF' }}>
            <span className="text-8xl">👨‍💻</span>
          </div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-7xl px-20 py-12">
        <div className="flex gap-10">
          {/* Left: Article Content */}
          <article className="flex-1 min-w-0">
            <div
              className="bg-white rounded-xl p-10 transition-all duration-300"
              style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.07), 0 1px 4px rgba(0, 0, 0, 0.03)' }}
            >
              <div className="prose max-w-none" style={{ color: '#4C4948' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ node, inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '')
                      return !inline && match ? (
                        <SyntaxHighlighter
                          style={vscDarkPlus}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ borderRadius: '8px', border: '1px solid #E5E7EB' }}
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      ) : (
                        <code className="px-2 py-1 rounded text-sm" style={{ backgroundColor: '#F3F4F6', color: '#49B1F5' }} {...props}>
                          {children}
                        </code>
                      )
                    },
                    h1: ({ children }) => <h1 className="text-3xl font-bold mt-8 mb-4" style={{ color: '#2C3E50' }}>{children}</h1>,
                    h2: ({ children }) => <h2 className="text-2xl font-bold mt-6 mb-3" style={{ color: '#2C3E50' }}>{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xl font-semibold mt-5 mb-2" style={{ color: '#2C3E50' }}>{children}</h3>,
                    p: ({ children }) => <p className="my-4 leading-relaxed text-base">{children}</p>,
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 pl-4 my-4 italic" style={{ borderColor: '#49B1F5', color: '#7F8C8D' }}>
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
          <div className="w-[380px] flex-shrink-0">
            <div className="sticky top-20">
              <Sidebar />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t px-6 sm:px-10 py-6" style={{ borderColor: 'var(--border-muted)' }}>
        <span className="font-terminal text-fluid-xs tracking-mono-normal" style={{ color: 'var(--accent)' }}>
          [EOF]
        </span>
      </footer>
    </main>
  )
}
