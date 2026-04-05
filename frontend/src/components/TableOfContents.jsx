import { useEffect, useState } from 'react'

export default function TableOfContents({ markdown }) {
  const [headings, setHeadings] = useState([])
  const [activeId, setActiveId] = useState('')

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

  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h4 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
        目录
      </h4>
      <nav className="space-y-0.5">
        {headings.map((h) => (
          <a
            key={h.id}
            href={`#${h.id}`}
            onClick={(e) => {
              e.preventDefault()
              const el = document.getElementById(h.id)
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={`toc-link ${h.level === 3 ? 'toc-link--h3' : ''} ${activeId === h.id ? 'toc-link--active' : ''}`}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </div>
  )
}
