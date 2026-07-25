import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, Calendar, Clock3, X } from 'lucide-react'

import { formatDate } from '../utils/date'
import { getContentTypeLabel } from '../utils/contentPresentation'

export default function ArticleQuickPreview({ post, onClose }) {
  const reduceMotion = useReducedMotion()
  const closeRef = useRef(null)
  const dialogRef = useRef(null)
  const restoreFocusRef = useRef(null)

  useEffect(() => {
    if (!post) return undefined
    restoreFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll('a, button:not(:disabled)') || [])
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
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      window.setTimeout(() => restoreFocusRef.current?.focus?.(), 0)
    }
  }, [onClose, post])

  return (
    <AnimatePresence>
      {post ? (
        <motion.div
          className="quick-preview-layer"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose()
          }}
        >
          <motion.aside
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-preview-title"
            className="quick-preview"
            initial={reduceMotion ? false : { opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="quick-preview__header">
              <span>QUICK CONTEXT</span>
              <button ref={closeRef} type="button" onClick={onClose} className="icon-button" aria-label="关闭文章预览">
                <X size={18} aria-hidden="true" />
              </button>
            </header>

            <div className="quick-preview__body">
              <span className="signal-badge signal-badge--cyan">{getContentTypeLabel(post.content_type)}</span>
              <h2 id="quick-preview-title">{post.title}</h2>
              <p>{post.summary || '这篇文章暂时没有摘要，打开正文查看完整内容。'}</p>

              <div className="quick-preview__meta">
                <span><Calendar size={14} aria-hidden="true" /> {post.coverage_date || formatDate(post.created_at)}</span>
                {post.reading_time ? <span><Clock3 size={14} aria-hidden="true" /> {post.reading_time} 分钟</span> : null}
              </div>

              {post.tags?.length ? (
                <div className="quick-preview__tags">
                  {post.tags.slice(0, 6).map((tag) => <span key={tag.slug}># {tag.name}</span>)}
                </div>
              ) : null}
            </div>

            <footer className="quick-preview__footer">
              <Link to={`/posts/${post.slug}`} onClick={onClose} className="signal-button signal-button--primary">
                阅读全文 <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <button type="button" onClick={onClose} className="signal-button signal-button--ghost">继续浏览</button>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
