import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command, Download, Search, X } from 'lucide-react'

import { fetchAccountLibrary } from '../../api/user'
import { ACCOUNT_TABS } from './AccountShell'

export default function AccountCommandPalette({ tabHref, onExport }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const triggerRef = useRef(null)
  const dialogRef = useRef(null)

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()

    function handleDialogKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        setQuery('')
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) || [])
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
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', handleDialogKeyDown)
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus?.()
    }
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setResults([])
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const payload = await fetchAccountLibrary({ q: query, pageSize: 8, signal: controller.signal })
        setResults(payload.items || [])
      } catch (error) {
        if (error?.name !== 'AbortError') setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  const commands = useMemo(() => {
    const sectionCommands = ACCOUNT_TABS.map((tab) => ({
      id: `tab-${tab.value}`,
      label: `前往${tab.label}`,
      detail: tab.description,
      action: () => navigate(tabHref(tab.value)),
    }))
    return [
      ...sectionCommands,
      {
        id: 'export',
        label: '导出我的数据',
        detail: '下载资料、关注与互动记录',
        icon: Download,
        action: onExport,
      },
    ]
  }, [navigate, onExport, tabHref])

  const items = query.trim().length >= 2
    ? results.map((item) => ({
        id: `${item.kind}-${item.id}`,
        label: item.title,
        detail: item.kind === 'comments' ? item.comment_content : item.summary,
        action: () => {
          if (item.available) navigate(`/posts/${item.slug}`)
          else navigate(`${tabHref('library')}&kind=${item.kind}`)
        },
      }))
    : commands

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open, items.length])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function run(item) {
    close()
    item?.action?.()
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, Math.max(items.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      run(items[activeIndex])
    }
  }

  return (
    <>
      <button ref={triggerRef} type="button" className="account-command-trigger" onClick={() => setOpen(true)}>
        <Command size={16} aria-hidden="true" />
        快速跳转与搜索
        <kbd>Ctrl K</kbd>
      </button>
      {open ? (
        <div className="account-command-layer" role="presentation">
          <button type="button" className="account-command-backdrop" onClick={close} aria-label="关闭个人中心搜索" tabIndex={-1} />
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-command-title" className="account-command-dialog">
            <h2 id="account-command-title" className="sr-only">个人中心快速跳转与搜索</h2>
            <div className="account-command-input">
              <Search size={18} aria-hidden="true" />
              <input
                ref={inputRef}
                type="search"
                name="account_command_query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="搜索历史、点赞与评论…"
                autoComplete="off"
                aria-controls="account-command-results"
                aria-activedescendant={items[activeIndex] ? `account-command-${items[activeIndex].id}` : undefined}
              />
              <button type="button" onClick={close} aria-label="关闭个人中心搜索"><X size={18} aria-hidden="true" /></button>
            </div>
            <div id="account-command-results" role="listbox" className="account-command-results" aria-busy={loading}>
              {loading ? <p role="status">正在搜索你的资料库…</p> : null}
              {!loading && !items.length ? <p>没有找到匹配内容。尝试更短的关键词。</p> : null}
              {!loading ? items.map((item, index) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    id={`account-command-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(item)}
                  >
                    {Icon ? <Icon size={17} aria-hidden="true" /> : <span className="account-command-result-dot" aria-hidden="true" />}
                    <span className="min-w-0">
                      <strong className="truncate">{item.label}</strong>
                      <small className="line-clamp-1">{item.detail || '打开内容'}</small>
                    </span>
                  </button>
                )
              }) : null}
            </div>
            <footer><span>↑↓ 选择</span><span>Enter 打开</span><span>Esc 关闭</span></footer>
          </section>
        </div>
      ) : null}
    </>
  )
}
