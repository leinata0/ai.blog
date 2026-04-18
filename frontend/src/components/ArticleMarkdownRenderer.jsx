import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { proxyImageUrl } from '../utils/proxyImage'

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

export default function ArticleMarkdownRenderer({ markdown = '', copiedCode = '', onCopy }) {
  const [syntaxState, setSyntaxState] = useState(null)
  const hasCodeFence = useMemo(() => /```[\s\S]*?```/.test(markdown), [markdown])

  useEffect(() => {
    if (!hasCodeFence) {
      setSyntaxState(null)
      return
    }

    let active = true
    Promise.all([
      import('react-syntax-highlighter'),
      import('react-syntax-highlighter/dist/esm/styles/prism'),
    ])
      .then(([syntaxModule, stylesModule]) => {
        if (!active) return
        setSyntaxState({
          SyntaxHighlighter: syntaxModule.Prism,
          syntaxStyle: stylesModule.vscDarkPlus,
        })
      })
      .catch(() => {
        if (!active) return
        setSyntaxState(null)
      })

    return () => {
      active = false
    }
  }, [hasCodeFence])

  return (
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
              const SyntaxHighlighter = syntaxState?.SyntaxHighlighter
              return (
                <div className="group relative my-4">
                  <button
                    type="button"
                    onClick={() => onCopy?.(code)}
                    className="absolute right-3 top-3 z-10 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  >
                    {copiedCode === code ? '已复制' : '复制'}
                  </button>
                  {SyntaxHighlighter ? (
                    <SyntaxHighlighter
                      style={syntaxState.syntaxStyle}
                      language={match[1]}
                      PreTag="div"
                      className="my-0 rounded-[1.2rem]"
                      {...props}
                    >
                      {code}
                    </SyntaxHighlighter>
                  ) : (
                    <pre className="overflow-x-auto rounded-[1.2rem] bg-slate-950 p-4 text-sm text-slate-100">
                      <code>{code}</code>
                    </pre>
                  )}
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
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
