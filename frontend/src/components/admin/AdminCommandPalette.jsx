import { useEffect, useMemo, useRef, useState } from 'react'
import { Command, FilePlus2, FileText, ListTodo, Search, X } from 'lucide-react'

import { fetchAdminPosts } from '../../api/admin'

const ARTICLE_SEARCH_DEBOUNCE_MS = 180
const ARTICLE_RESULT_LIMIT = 6

export default function AdminCommandPalette({
  open,
  onClose,
  groups,
  activeSection,
  onSelectSection,
  onCreatePost,
  onOpenPost,
  onOpenJobs,
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [articleResults, setArticleResults] = useState([])
  const [articleLoading, setArticleLoading] = useState(false)
  const [articleError, setArticleError] = useState('')
  const inputRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const articleRequestRef = useRef(0)

  useEffect(() => {
    if (!open) return undefined
    restoreFocusRef.current = document.activeElement
    setQuery('')
    setActiveIndex(0)
    setArticleResults([])
    setArticleError('')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => inputRef.current?.focus())

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = inputRef.current?.closest('[role="dialog"]')
      const focusable = dialog
        ? Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), [href]'))
        : []
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  const commands = useMemo(() => {
    const sectionCommands = groups.flatMap((group) =>
      group.items.map((item) => ({
        id: `section-${item.key}`,
        label: item.label,
        detail: group.label,
        icon: item.icon,
        active: item.key === activeSection,
        run: () => onSelectSection(item.key),
      }))
    )
    return [
      {
        id: 'create-post',
        label: '新建文章',
        detail: '内容',
        icon: FilePlus2,
        run: onCreatePost,
      },
      {
        id: 'jobs',
        label: '打开任务面板',
        detail: '运行',
        icon: ListTodo,
        run: onOpenJobs,
      },
      ...sectionCommands,
    ]
  }, [activeSection, groups, onCreatePost, onOpenJobs, onSelectSection])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const commandResults = normalizedQuery
    ? commands.filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(normalizedQuery))
    : commands

  useEffect(() => {
    const searchTerm = query.trim()
    articleRequestRef.current += 1
    const requestId = articleRequestRef.current

    if (!open || !searchTerm) {
      setArticleResults([])
      setArticleLoading(false)
      setArticleError('')
      return undefined
    }

    setArticleLoading(true)
    setArticleError('')
    const timer = window.setTimeout(async () => {
      try {
        const payload = await fetchAdminPosts({
          q: searchTerm,
          page: 1,
          page_size: ARTICLE_RESULT_LIMIT,
        })
        if (requestId !== articleRequestRef.current) return
        setArticleResults(payload?.items || payload || [])
      } catch (error) {
        if (requestId !== articleRequestRef.current) return
        setArticleResults([])
        setArticleError(error?.message || '文章搜索失败')
      } finally {
        if (requestId === articleRequestRef.current) setArticleLoading(false)
      }
    }, ARTICLE_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      // The timer may already have fired and be awaiting fetchAdminPosts. Bumping the
      // request id invalidates that in-flight response so it cannot setState after the
      // palette closed or the query moved on.
      articleRequestRef.current += 1
    }
  }, [open, query])

  const articleCommands = useMemo(() => articleResults.map((post) => ({
    id: `post-${post.id}`,
    label: post.title || `文章 #${post.id}`,
    detail: `文章 · ${post.slug || '未设置 slug'}`,
    icon: FileText,
    run: () => onOpenPost?.(post),
  })), [articleResults, onOpenPost])

  const results = [...commandResults, ...articleCommands]

  useEffect(() => {
    setActiveIndex(0)
  }, [articleResults, query])

  if (!open) return null

  function runCommand(command) {
    command.run()
    onClose()
  }

  function handleInputKeyDown(event) {
    if (!results.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runCommand(results[activeIndex] || results[0])
    }
  }

  return (
    <div className="ops-command-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="ops-command"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-command-title"
      >
        <div className="ops-command__search">
          <Command size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="ops-command-input">搜索管理命令</label>
          <input
            ref={inputRef}
            id="ops-command-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="搜索分区或操作…"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="ops-command-results"
            aria-activedescendant={results[activeIndex] ? `ops-command-option-${results[activeIndex].id}` : undefined}
          />
          <button type="button" onClick={onClose} aria-label="关闭管理命令面板">
            <X size={17} />
          </button>
        </div>
        <div className="ops-command__heading">
          <div>
            <span className="ops-eyebrow">COMMAND INDEX</span>
            <h2 id="ops-command-title">运营导航</h2>
          </div>
          <span>{articleLoading ? '搜索文章中…' : `${results.length} 项`}</span>
        </div>
        <div className="sr-only" role="status" aria-live="polite">
          {articleLoading
            ? '正在搜索管理文章'
            : articleError
              ? `文章搜索失败：${articleError}`
              : normalizedQuery
                ? `找到 ${results.length} 项结果，其中 ${articleResults.length} 篇文章`
                : `${results.length} 项管理命令`}
        </div>
        <div id="ops-command-results" className="ops-command__results" role="listbox" aria-label="管理命令">
          {results.map(({ id, label, detail, icon: Icon, active, run }, index) => (
            <button
              key={id}
              id={`ops-command-option-${id}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-current={active || undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runCommand({ run })}
            >
              <span className="ops-command__icon"><Icon size={16} /></span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              {active ? <em>当前</em> : null}
            </button>
          ))}
          {!results.length && !articleLoading ? (
            <div className="ops-command__empty">
              <Search size={18} />
              <span>{articleError ? '文章搜索暂时不可用，请重试' : '没有匹配的分区、操作或文章'}</span>
            </div>
          ) : null}
          {articleLoading ? (
            <div className="ops-command__loading" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
        <footer>按 Esc 关闭 · Ctrl / ⌘ + K 随时唤起</footer>
      </section>
    </div>
  )
}
