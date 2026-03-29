import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { fetchPostDetail } from '../api/posts'
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
        <div className="mx-auto max-w-3xl px-6 sm:px-10 pt-22 sm:pt-30">
          <ArticleSkeleton size="hero" />
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <div className="mx-auto max-w-3xl px-6 sm:px-10 pt-22 sm:pt-30">
          <div
            data-ui="detail-error"
            className="rounded-sharp px-8 py-6"
            style={{
              backgroundColor: 'var(--danger-soft)',
              border: '1px solid var(--danger-border)',
              color: 'var(--text-primary)',
            }}
          >
            <span className="font-terminal text-fluid-xs tracking-mono-normal" style={{ color: 'var(--text-faint)' }}>
              error: {' '}
            </span>
            {error}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main data-ui="detail-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      {/* Nav */}
      <nav
        className="sticky top-0 z-50 flex items-center px-6 sm:px-10"
        style={{
          height: '52px',
          borderBottom: '1px solid var(--border-muted)',
          backgroundColor: 'var(--bg-canvas)',
        }}
      >
        <a
          href="/"
          className="font-terminal text-fluid-sm font-medium tracking-mono-normal"
          style={{ color: 'var(--accent)' }}
        >
          <span style={{ color: 'var(--text-faint)' }}>~/</span>back
        </a>
      </nav>

      <article
        data-ui="detail-article"
        className="mx-auto max-w-3xl px-6 sm:px-10 pt-18 sm:pt-26 pb-26 sm:pb-38"
      >
        {/* Tags — monospace */}
        <div className="flex flex-wrap gap-2 mb-6">
          {post.tags.map((tag) => (
            <span key={tag.slug} className="term-tag">
              {tag.name}
            </span>
          ))}
        </div>

        {/* Title */}
        <h1
          className="text-fluid-3xl font-extrabold tracking-tight mb-5"
          style={{ letterSpacing: '-0.025em' }}
        >
          {post.title}
        </h1>

        {/* Summary */}
        <p
          className="max-w-2xl text-fluid-lg leading-relaxed mb-10 pb-10"
          style={{
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-muted)',
          }}
        >
          {post.summary}
        </p>

        {/* Content body */}
        <div
          className="prose-geek max-w-none text-fluid-base leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
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
              table: ({ children }) => <table className="w-full my-6 border-collapse" style={{ borderColor: 'var(--border-muted)' }}>{children}</table>,
              th: ({ children }) => <th className="border px-4 py-2 text-left font-semibold" style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-inset)' }}>{children}</th>,
              td: ({ children }) => <td className="border px-4 py-2" style={{ borderColor: 'var(--border-muted)' }}>{children}</td>,
              ul: ({ children }) => <ul className="list-disc list-inside my-4 space-y-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside my-4 space-y-2">{children}</ol>,
              p: ({ children }) => <p className="my-4">{children}</p>,
            }}
          >
            {post.content_md}
          </ReactMarkdown>
        </div>
      </article>

      {/* Footer */}
      <footer
        className="border-t px-6 sm:px-10 py-6"
        style={{ borderColor: 'var(--border-muted)' }}
      >
        <span
          className="font-terminal text-fluid-xs tracking-mono-normal"
          style={{ color: 'var(--accent)' }}
        >
          [EOF]
        </span>
      </footer>
    </main>
  )
}
