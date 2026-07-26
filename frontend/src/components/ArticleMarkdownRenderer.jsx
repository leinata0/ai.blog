import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { proxyImageUrl } from '../utils/proxyImage'
import { createHeadingIdLookup, slugifyHeading } from '../utils/headingIds'

function flattenToText(children) {
  if (children == null || typeof children === 'boolean') return ''
  if (typeof children === 'string' || typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(flattenToText).join('')
  if (typeof children === 'object' && children.props) return flattenToText(children.props.children)
  return ''
}

export function MarkdownImage({ src, alt, title }) {
  if (!src) return null
  return <MarkdownImageAttempt key={src} src={src} alt={alt} title={title} />
}

function MarkdownImageAttempt({ src, alt, title }) {
  const [failed, setFailed] = useState(false)
  const [retryCount, setRetryCount] = useState(0)

  const proxiedSrc = proxyImageUrl(src)
  const imageSrc = retryCount > 0
    ? `${proxiedSrc}${proxiedSrc.includes('?') ? '&' : '?'}media_retry=${retryCount}`
    : proxiedSrc

  if (failed) {
    return (
      <span
        className="not-prose my-8 flex min-h-28 flex-col items-start justify-center gap-3 rounded-[1.2rem] border px-5 py-4 text-sm"
        style={{ borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}
      >
        <span role="status">图片暂时不可用，请稍后重试。</span>
        <button
          type="button"
          onClick={() => {
            setRetryCount((count) => count + 1)
            setFailed(false)
          }}
          className="inline-flex min-h-11 items-center rounded-full border px-4 py-2 font-medium transition-[transform,background-color] duration-100 active:scale-[0.98]"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}
        >
          重新加载图片
        </button>
      </span>
    )
  }

  return (
    <span className="not-prose my-8 block overflow-hidden rounded-[1.6rem] border" style={{ borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow-soft)' }}>
      <img
        src={imageSrc}
        alt={typeof alt === 'string' ? alt : ''}
        title={title}
        width="1200"
        height="675"
        loading="lazy"
        referrerPolicy="no-referrer"
        className="block h-auto w-full object-cover"
        onError={() => setFailed(true)}
      />
    </span>
  )
}

// 渲染期状态走 context，components 映射本身才能是模块级常量。
// 如果 components 里放内联箭头函数，每次重渲染的组件类型都是新引用，
// React 会把整篇正文 unmount + remount：图片重新发请求、代码块状态丢失、锚点节点被换掉。
const CodeBlockContext = createContext({ copiedCode: '', onCopy: undefined, syntaxState: null })
const HeadingIdContext = createContext(null)

function CodeBlock({ code, language }) {
  const { copiedCode, onCopy, syntaxState } = useContext(CodeBlockContext)
  const SyntaxHighlighter = language ? syntaxState?.SyntaxHighlighter : null

  return (
    <div className="not-prose group relative my-6 overflow-hidden rounded-[1.2rem] shadow-lg ring-1 ring-slate-800/60">
      <button
        type="button"
        onClick={() => onCopy?.(code)}
        className="absolute right-3 top-3 z-10 rounded-md bg-slate-900/80 px-2.5 py-1 text-xs font-medium text-white opacity-0 transition-opacity duration-200 focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copiedCode === code ? '已复制' : '复制'}
      </button>
      {SyntaxHighlighter ? (
        <SyntaxHighlighter
          style={syntaxState.syntaxStyle}
          language={language}
          PreTag="div"
          className="my-0 overflow-x-auto rounded-[1.2rem]"
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre className="my-0 overflow-x-auto rounded-[1.2rem] bg-slate-950 p-4 text-sm text-slate-100">
          <code className="whitespace-pre font-mono">{code}</code>
        </pre>
      )}
    </div>
  )
}

/**
 * react-markdown v9+ 不再传 `inline` prop，所以"是不是块级代码"必须靠"有没有 pre 父节点"来判断。
 * 这里由 `pre` 组件接管整块渲染（它拿到的 children 就是尚未渲染的 <code> 元素），
 * 于是没有语言标记的 ``` 围栏也会走块级分支，而不会塌成单行 nowrap 的行内 code。
 */
function readFencedCode(children) {
  const child = Array.isArray(children) ? children.find(Boolean) : children
  const childProps = child?.props || {}
  const className = typeof childProps.className === 'string' ? childProps.className : ''
  const language = /language-(\w+)/.exec(className)?.[1] || ''
  return { language, code: flattenToText(childProps.children).replace(/\n$/, '') }
}

function MarkdownPre({ children }) {
  const { language, code } = readFencedCode(children)
  if (!code) {
    return (
      <div className="not-prose my-6 overflow-hidden rounded-[1.2rem] shadow-lg ring-1 ring-slate-800/60">
        <pre className="my-0 overflow-x-auto rounded-[1.2rem] bg-slate-950 p-4 text-sm text-slate-100">{children}</pre>
      </div>
    )
  }
  return <CodeBlock code={code} language={language} />
}

// 只处理行内 code：块级围栏已经被 MarkdownPre 完整接管。
// `node` 必须显式解构掉，否则会被展开成 DOM 属性 node="[object Object]"。
function MarkdownInlineCode({ node, className, children, ...props }) {
  return (
    <code
      className={`whitespace-pre-wrap break-words rounded-md px-1.5 py-0.5 text-sm font-mono ${className || ''}`.trim()}
      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
      {...props}
    >
      {children}
    </code>
  )
}

function MarkdownH1({ children }) {
  const text = flattenToText(children)
  // h1 is not in the TOC — keep it out of the shared h2/h3 id space.
  const id = slugifyHeading(text) || 'title'
  return <h1 id={id} className="font-display text-4xl font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{children}</h1>
}

function MarkdownH2({ node, children }) {
  const lookupHeadingId = useContext(HeadingIdContext)
  const text = flattenToText(children)
  const id = lookupHeadingId?.(text, node?.position?.start?.line) || slugifyHeading(text) || 'section'
  return <h2 id={id} className="mt-10 font-display text-[2rem] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{children}</h2>
}

function MarkdownH3({ node, children }) {
  const lookupHeadingId = useContext(HeadingIdContext)
  const text = flattenToText(children)
  const id = lookupHeadingId?.(text, node?.position?.start?.line) || slugifyHeading(text) || 'section'
  return <h3 id={id} className="mt-8 font-display text-[1.45rem] font-semibold tracking-[-0.02em]" style={{ color: 'var(--text-primary)' }}>{children}</h3>
}

const MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
  code: MarkdownInlineCode,
  h1: MarkdownH1,
  h2: MarkdownH2,
  h3: MarkdownH3,
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
}

const REMARK_PLUGINS = [remarkGfm]

export default function ArticleMarkdownRenderer({ markdown = '', copiedCode = '', onCopy }) {
  const [syntaxState, setSyntaxState] = useState(null)
  const hasCodeFence = useMemo(() => /```[\s\S]*?```/.test(markdown), [markdown])
  // 纯查表：同一份 markdown 无论重渲染多少次，id 都和 TOC 的 parseMarkdownHeadings 完全一致。
  const lookupHeadingId = useMemo(() => createHeadingIdLookup(markdown), [markdown])
  const codeBlockValue = useMemo(
    () => ({ copiedCode, onCopy, syntaxState }),
    [copiedCode, onCopy, syntaxState],
  )

  useEffect(() => {
    if (!hasCodeFence) {
      setSyntaxState(null)
      return
    }

    let active = true
    const languageNames = [
      'javascript',
      'typescript',
      'jsx',
      'tsx',
      'python',
      'bash',
      'cpp',
      'json',
      'yaml',
      'markup',
      'sql',
      'nginx',
    ]

    Promise.all([
      import('react-syntax-highlighter/dist/esm/prism-light'),
      import('react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus'),
      import('react-syntax-highlighter/dist/esm/languages/prism/javascript'),
      import('react-syntax-highlighter/dist/esm/languages/prism/typescript'),
      import('react-syntax-highlighter/dist/esm/languages/prism/jsx'),
      import('react-syntax-highlighter/dist/esm/languages/prism/tsx'),
      import('react-syntax-highlighter/dist/esm/languages/prism/python'),
      import('react-syntax-highlighter/dist/esm/languages/prism/bash'),
      import('react-syntax-highlighter/dist/esm/languages/prism/cpp'),
      import('react-syntax-highlighter/dist/esm/languages/prism/json'),
      import('react-syntax-highlighter/dist/esm/languages/prism/yaml'),
      import('react-syntax-highlighter/dist/esm/languages/prism/markup'),
      import('react-syntax-highlighter/dist/esm/languages/prism/sql'),
      import('react-syntax-highlighter/dist/esm/languages/prism/nginx'),
    ])
      .then(([syntaxModule, stylesModule, ...languageModules]) => {
        if (!active) return
        const SyntaxHighlighter = syntaxModule.default
        languageModules.forEach((languageModule, index) => {
          SyntaxHighlighter.registerLanguage(languageNames[index], languageModule.default)
        })
        SyntaxHighlighter.alias('javascript', ['js'])
        SyntaxHighlighter.alias('typescript', ['ts'])
        SyntaxHighlighter.alias('bash', ['sh', 'shell'])
        SyntaxHighlighter.alias('yaml', ['yml'])
        SyntaxHighlighter.alias('markup', ['html', 'xml'])
        setSyntaxState({
          SyntaxHighlighter,
          syntaxStyle: stylesModule.default,
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
      <HeadingIdContext.Provider value={lookupHeadingId}>
        <CodeBlockContext.Provider value={codeBlockValue}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {markdown}
          </ReactMarkdown>
        </CodeBlockContext.Provider>
      </HeadingIdContext.Provider>
    </div>
  )
}
