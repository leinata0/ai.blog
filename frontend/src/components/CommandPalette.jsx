import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Compass,
  FileText,
  Hash,
  Layers3,
  Search,
  Sparkles,
  X,
} from 'lucide-react'

import { fetchSearch } from '../api/posts'
import { OPEN_COMMAND_PALETTE_EVENT } from '../utils/uiEvents'

const QUICK_DESTINATIONS = [
  { label: '今日信号台', description: '回到最新 AI 动态', to: '/', icon: Sparkles },
  { label: '发现', description: '浏览编辑精选与趋势', to: '/discover', icon: Compass },
  { label: '主题网络', description: '沿主题持续追踪', to: '/topics', icon: Hash },
  { label: '系列', description: '按栏目连续阅读', to: '/series', icon: Layers3 },
  { label: '归档', description: '按时间回看全部内容', to: '/archive', icon: BookOpen },
]

function normalizeResults(payload) {
  const posts = (payload?.items || []).slice(0, 5).map((post) => ({
    key: `post-${post.slug}`,
    label: post.title,
    description: post.summary || '打开文章',
    to: `/posts/${post.slug}`,
    icon: FileText,
    kind: '文章',
  }))
  const topics = (payload?.topics || []).slice(0, 3).map((topic) => ({
    key: `topic-${topic.topic_key}`,
    label: topic.display_title || topic.topic_key,
    description: topic.description || '进入主题追踪',
    to: `/topics/${topic.topic_key}`,
    icon: Hash,
    kind: '主题',
  }))
  const series = (payload?.series_suggestions || []).slice(0, 3).map((item) => ({
    key: `series-${item.slug}`,
    label: item.title || item.slug,
    description: item.description || '进入系列阅读',
    to: `/series/${item.slug}`,
    icon: Layers3,
    kind: '系列',
  }))
  return [...posts, ...topics, ...series]
}

export default function CommandPalette() {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const inputRef = useRef(null)
  const dialogRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const items = useMemo(() => {
    if (query.trim()) {
      const searchDestination = {
        key: 'full-search',
        label: `搜索“${query.trim()}”`,
        description: '在完整搜索页查看更多结果',
        to: `/search?q=${encodeURIComponent(query.trim())}`,
        icon: Search,
        kind: '搜索',
      }
      return [...results, searchDestination]
    }
    return QUICK_DESTINATIONS.map((item) => ({ ...item, key: item.to, kind: '导航' }))
  }, [query, results])

  useEffect(() => {
    function showPalette() {
      restoreFocusRef.current = document.activeElement
      setOpen(true)
    }
    function handleGlobalKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        showPalette()
      }
    }

    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, showPalette)
    document.addEventListener('keydown', handleGlobalKey)
    return () => {
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, showPalette)
      document.removeEventListener('keydown', handleGlobalKey)
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.clearTimeout(focusTimer)
    }
  }, [open])

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([])
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      fetchSearch(
        { q: query.trim(), limit: 8 },
        { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
      )
        .then((payload) => {
          if (!controller.signal.aborted) setResults(normalizeResults(payload))
        })
        .catch((error) => {
          if (!controller.signal.aborted && error?.name !== 'AbortError') setResults([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 180)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [items.length, query])

  function closePalette() {
    setOpen(false)
    setQuery('')
    setResults([])
    window.setTimeout(() => restoreFocusRef.current?.focus?.(), 0)
  }

  function choose(item) {
    navigate(item.to)
    closePalette()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % Math.max(items.length, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1))
      return
    }
    if (event.key === 'Enter' && items[activeIndex]) {
      event.preventDefault()
      choose(items[activeIndex])
      return
    }
    if (event.key === 'Tab') {
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not(:disabled), input') || [])
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
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="command-palette-layer"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePalette()
          }}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="智能命令搜索"
            className="command-palette"
            onKeyDown={handleKeyDown}
            initial={reduceMotion ? false : { opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="command-palette__search">
              <Search size={19} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                role="combobox"
                aria-expanded="true"
                aria-autocomplete="list"
                name="command-search"
                autoComplete="off"
                spellCheck={false}
                aria-label="搜索文章、主题、系列或页面"
                aria-controls="command-palette-results"
                aria-activedescendant={items[activeIndex] ? `command-${items[activeIndex].key}` : undefined}
                placeholder="搜索文章、主题、系列或页面…"
              />
              <button type="button" onClick={closePalette} className="icon-button" aria-label="关闭智能搜索">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="command-palette__meta">
              <span>{query.trim() ? '智能匹配' : '快速前往'}</span>
              <span aria-live="polite">{loading ? '正在搜索…' : `${items.length} 个选项`}</span>
            </div>

            <div id="command-palette-results" role="listbox" className="command-palette__results">
              {items.map((item, index) => {
                const Icon = item.icon
                const active = activeIndex === index
                return (
                  <button
                    id={`command-${item.key}`}
                    key={item.key}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(item)}
                    className={`command-result ${active ? 'command-result--active' : ''}`}
                  >
                    <span className="command-result__icon"><Icon size={17} aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="command-result__kind">{item.kind}</span>
                      <span className="command-result__label">{item.label}</span>
                      <span className="command-result__description">{item.description}</span>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )
              })}
            </div>

            <footer className="command-palette__footer">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>Enter</kbd> 打开</span>
              <span><kbd>Esc</kbd> 关闭</span>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
