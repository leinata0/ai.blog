import { useEffect, useMemo, useRef, useState } from 'react'
import { List, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

import {
  parseMarkdownHeadings,
  READING_SCROLL_OFFSET_PX,
} from '../utils/headingIds'

function findActiveHeadingId(headings, offsetPx) {
  if (!headings.length || typeof document === 'undefined') return ''

  let activeId = ''
  for (const heading of headings) {
    const el = document.getElementById(heading.id)
    if (!el) continue
    const top = el.getBoundingClientRect().top
    if (top - offsetPx <= 1) {
      activeId = heading.id
    } else {
      break
    }
  }

  if (activeId) return activeId

  // Before any heading reaches the offset (top of article), highlight the first one that exists.
  for (const heading of headings) {
    if (document.getElementById(heading.id)) return heading.id
  }
  return ''
}

export default function TableOfContents({ markdown, mobile = false }) {
  const headings = useMemo(() => parseMarkdownHeadings(markdown), [markdown])
  const [activeId, setActiveId] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const activeIdRef = useRef('')
  const tickingRef = useRef(false)

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId('')
      activeIdRef.current = ''
      return undefined
    }

    const update = () => {
      tickingRef.current = false
      const next = findActiveHeadingId(headings, READING_SCROLL_OFFSET_PX)
      if (next && next !== activeIdRef.current) {
        activeIdRef.current = next
        setActiveId(next)
      } else if (!next && activeIdRef.current) {
        activeIdRef.current = ''
        setActiveId('')
      }
    }

    const onScrollOrResize = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      window.requestAnimationFrame(update)
    }

    update()
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    window.addEventListener('resize', onScrollOrResize)

    // Markdown is lazy-loaded; re-check when heading nodes appear in the DOM.
    const observer = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(onScrollOrResize)
      : null
    const root = document.querySelector('[data-ui="detail-article"]') || document.body
    observer?.observe(root, { childList: true, subtree: true })

    // Heading ids are now deterministic (see utils/headingIds), so the old
    // [120, 400, 1000] retry ladder is no longer needed to paper over drifting ids.
    // One deferred pass still covers environments without MutationObserver.
    const retryTimer = observer ? null : window.setTimeout(update, 300)

    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      window.removeEventListener('resize', onScrollOrResize)
      observer?.disconnect()
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [headings])

  if (headings.length === 0) return null

  function handleClick(event, id) {
    event.preventDefault()
    const el = document.getElementById(id)

    // The article body is lazy-loaded; if the heading is not mounted yet we still record
    // the selection and the hash instead of making the click look completely dead.
    if (el) {
      const top = window.scrollY + el.getBoundingClientRect().top - READING_SCROLL_OFFSET_PX
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' })
    }
    activeIdRef.current = id
    setActiveId(id)

    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(window.history.state, '', `#${id}`)
    }
    if (mobile) setMobileOpen(false)
  }

  const tocNav = (
    <nav className="space-y-0.5" aria-label="文章目录">
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          onClick={(e) => handleClick(e, h.id)}
          className={`toc-link ${h.level === 3 ? 'toc-link--h3' : ''} ${activeId === h.id ? 'toc-link--active' : ''}`}
          aria-current={activeId === h.id ? 'true' : undefined}
        >
          {h.text}
        </a>
      ))}
    </nav>
  )

  if (mobile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="fixed z-40 right-4 bottom-24 w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-[transform,background-color,box-shadow] duration-200"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          aria-label="打开目录"
        >
          <List size={20} />
        </button>

        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/40"
                onClick={() => setMobileOpen(false)}
              />
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                className="fixed right-0 top-0 bottom-0 z-50 w-72 overflow-y-auto p-5"
                style={{ backgroundColor: 'var(--bg-surface)', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>目录</h4>
                  <button type="button" onClick={() => setMobileOpen(false)} className="p-1 rounded" style={{ color: 'var(--text-faint)' }} aria-label="关闭目录">
                    <X size={18} />
                  </button>
                </div>
                {tocNav}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </>
    )
  }

  return (
    <div
      className="rounded-xl p-5"
      data-ui="article-toc"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
        目录
      </h4>
      {tocNav}
    </div>
  )
}
