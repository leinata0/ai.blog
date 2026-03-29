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
    <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <Navbar />

      {/* Hero Section */}
      <div
        className="relative px-6 sm:px-10 py-12 sm:py-16"
        style={{ backgroundColor: 'var(--bg-canvas-deep)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap gap-2 mb-4">
            {post.tags.map((tag) => (
              <span key={tag.slug} className="term-tag">{tag.name}</span>
            ))}
          </div>
          <h1 className="text-fluid-3xl font-extrabold tracking-tight mb-4" style={{ letterSpacing: '-0.025em' }}>
            {post.title}
          </h1>
          <p className="text-fluid-lg leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
            {post.summary}
          </p>
          <div className="flex items-center gap-4 text-fluid-xs" style={{ color: 'var(--text-faint)' }}>
            <span>📅 2026-03-29</span>
            <span>⏱️ 阅读时长: 5分钟</span>
          </div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-6xl px-6 sm:px-10 py-10 sm:py-14">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left: Article Content */}
          <article className="flex-1 min-w-0">
            <div className="prose prose-invert max-w-none text-fluid-base leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
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
                        customStyle={{ borderRadius: '6px', border: '1px solid #2a2a2a' }}
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className="px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-inset)', color: 'var(--accent)' }} {...props}>
                        {children}
                      </code>
                    )
                  },
                  h1: ({ children }) => <h1 className="text-fluid-2xl font-bold mt-10 mb-4" style={{ color: 'var(--text-primary)' }}>{children}</h1>,
                  h2: ({ children }) => <h2 className="text-fluid-xl font-bold mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>{children}</h2>,
                  h3: ({ children }) => <h3 className="text-fluid-lg font-semibold mt-6 mb-2" style={{ color: 'var(--text-primary)' }}>{children}</h3>,
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 pl-4 my-4 italic" style={{ borderColor: 'var(--accent)', color: 'var(--text-tertiary)' }}>
                      {children}
                    </blockquote>
                  ),
                  table: ({ children }) => <table className="w-full my-6 border-collapse rounded-lg overflow-hidden" style={{ border: '1px solid #2a2a2a' }}>{children}</table>,
                  th: ({ children }) => <th className="border px-4 py-2 text-left font-semibold" style={{ borderColor: '#2a2a2a', backgroundColor: 'var(--bg-inset)' }}>{children}</th>,
                  td: ({ children }) => <td className="border px-4 py-2" style={{ borderColor: '#2a2a2a' }}>{children}</td>,
                  ul: ({ children }) => <ul className="list-disc list-inside my-4 space-y-2">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-inside my-4 space-y-2">{children}</ol>,
                  p: ({ children }) => <p className="my-4">{children}</p>,
                }}
              >
                {post.content_md}
              </ReactMarkdown>
            </div>
          </article>

          {/* Right: Sidebar */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="lg:sticky lg:top-20">
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
