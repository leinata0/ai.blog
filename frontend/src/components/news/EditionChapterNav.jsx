import { useEffect, useState } from 'react'
import '../../styles/news-edition-nav.css'

const CHAPTERS = [
  { id: 'edition-focus', numeral: 'I', title: '本期焦点' },
  { id: 'edition-news', numeral: 'II', title: '新闻档案' },
  { id: 'edition-topics', numeral: 'III', title: '领域探索' },
  { id: 'edition-reading', numeral: 'IV', title: '阅读与订阅' },
]

export default function EditionChapterNav({ ready = true }) {
  const [activeId, setActiveId] = useState(CHAPTERS[0].id)
  const [coverVisible, setCoverVisible] = useState(false)

  useEffect(() => {
    if (!ready) return undefined
    const id = window.location.hash.slice(1)
    if (!CHAPTERS.some((chapter) => chapter.id === id)) return undefined
    // A fresh SPA document has no anchor targets until React and news data
    // mount. Restore the shared chapter URL after the final layout is ready.
    const frame = requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView?.({ behavior: 'instant', block: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [ready])

  useEffect(() => {
    const cover = document.querySelector('.edition-navigation-sentinel') || document.querySelector('.edition-hero')
    if (!cover || typeof window.IntersectionObserver !== 'function') return undefined
    // The cover has its own directory. Show the floating one only after the
    // artwork leaves the viewport, so it never obscures short-screen controls.
    setCoverVisible(cover.getBoundingClientRect().bottom > 0)
    const coverObserver = new window.IntersectionObserver(([entry]) => {
      setCoverVisible(entry.isIntersecting || entry.boundingClientRect?.top > 0)
    })
    coverObserver.observe(cover)
    return () => coverObserver.disconnect()
  }, [])

  useEffect(() => {
    if (typeof window.IntersectionObserver !== 'function') return undefined

    const targets = new Map()
    const intersecting = new Set()
    let targetWatcher
    let observer
    function onIntersection(entries) {
      entries.forEach((entry) => {
        if (entry.isIntersecting) intersecting.add(entry.target.id)
        else intersecting.delete(entry.target.id)
      })
      // A narrow reading band near the upper fifth follows long article sections
      // without scroll handlers or interfering with native anchor navigation.
      const candidate = [...targets.values()]
        .filter((node) => intersecting.has(node.id))
        .sort((a, b) => Math.abs(a.getBoundingClientRect().top - window.innerHeight * .2)
          - Math.abs(b.getBoundingClientRect().top - window.innerHeight * .2))[0]
      if (candidate) setActiveId(candidate.id)
    }

    function resetObserver() {
      observer?.disconnect()
      intersecting.clear()
      // IO percentage margins resolve against width, so use viewport-height
      // pixels to keep this reading band valid on wide desktop screens.
      const height = window.innerHeight
      observer = new window.IntersectionObserver(onIntersection, {
        rootMargin: `-${Math.floor(height * .2)}px 0px -${Math.floor(height * .79)}px 0px`,
        threshold: 0,
      })
      targets.forEach((node) => observer.observe(node))
    }

    function observeTargets() {
      CHAPTERS.forEach(({ id }) => {
        const node = document.getElementById(id)
        if (node && targets.get(id) !== node) {
          if (targets.has(id)) observer.unobserve(targets.get(id))
          targets.set(id, node)
          observer.observe(node)
        }
      })
      if (targets.size === CHAPTERS.length) targetWatcher?.disconnect()
    }

    resetObserver()
    observeTargets()
    // The news container can mount after its initial data request completes.
    if (targets.size < CHAPTERS.length && typeof window.MutationObserver === 'function') {
      targetWatcher = new window.MutationObserver(observeTargets)
      targetWatcher.observe(document.getElementById('main-content') || document.body, {
        childList: true, subtree: true,
      })
    }
    window.addEventListener('resize', resetObserver)
    return () => {
      observer.disconnect()
      targetWatcher?.disconnect()
      window.removeEventListener('resize', resetObserver)
    }
  }, [])

  return (
    <nav className={`edition-chapter-nav${coverVisible ? ' edition-chapter-nav--cover' : ''}`} aria-label="本期展览目录" aria-hidden={coverVisible || undefined} inert={coverVisible ? '' : undefined}>
      <span className="edition-chapter-nav__heading">本期目录</span>
      <ol>
        {CHAPTERS.map(({ id, numeral, title }) => (
          <li key={id}>
            <a href={`#${id}`} aria-current={activeId === id ? 'location' : undefined} onClick={() => setActiveId(id)}>
              <span className="edition-chapter-nav__numeral" aria-hidden="true">{numeral}</span>
              <span>{title}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
