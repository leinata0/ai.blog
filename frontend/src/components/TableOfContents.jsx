import { useEffect, useState } from 'react'
import { List, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

export default function TableOfContents({ markdown, mobile = false }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!markdown) return
    const lines = markdown.split('\n')
    const parsed = []
    lines.forEach((line) => {
      const m = line.match(/^(#{1,3})\s+(.+)$/)
      if (m) {
        const level = m[1].length
        const text = m[2].replace(/[`*_~]/g, '').trim()
        const id = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '')
        if (level >= 2) {
          parsed.push({ level, text, id })
        }
      }
    })
    setHeadings(parsed)
  }, [markdown])

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          setActiveId(visible[0].target.id)
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    )
    headings.forEach((h) => {
      const el = document.getElementById(h.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [headings])

  if (headings.length === 0) return null

  function handleClick(e, id) {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (mobile) setMobileOpen(false)
  }

  const tocNav = (
    <nav className="space-y-0.5">
      {headings.map((h) => (
        <a
          key={h.id}
          href={`#${h.id}`}
          onClick={(e) => handleClick(e, h.id)}
          className={`toc-link ${h.level === 3 ? 'toc-link--h3' : ''} ${activeId === h.id ? 'toc-link--active' : ''}`}
        >
          {h.text}
        </a>
      ))}
    </nav>
  )

  // 移动端：浮动按钮 + 滑入面板
  if (mobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed z-40 right-4 bottom-24 w-11 h-11 rounded-full flex items-center justify-center shadow-lg transition-all duration-200"
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
                  <button onClick={() => setMobileOpen(false)} className="p-1 rounded" style={{ color: 'var(--text-faint)' }}>
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

  // 桌面端：正常侧边栏 TOC
  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
        目录
      </h4>
      {tocNav}
    </div>
  )
}
