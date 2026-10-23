import { useEffect } from 'react'

const TARGETS = [
  ['.edition-section-heading h2, .tech-topics h2, .news-feed__heading h2', 'title'],
  ['.tech-feature__visual', 'feature'],
  ['.news-list-story', 'story'],
  ['.tech-topics', 'topics'],
  ['.tech-topic', 'topic'],
]
const clamp = (value) => Math.min(1, Math.max(0, value))

// One passive scroll listener writes compositor properties without React renders.
// Enhancement is optional: unsupported observers and reduced motion keep the base page.
export default function useEditionChoreography(ref, enabled) {
  useEffect(() => {
    const root = ref.current
    if (!enabled || !root || typeof window.IntersectionObserver !== 'function') return undefined
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let dispose = () => {}

    function start() {
      if (preference?.matches) return
      const records = new Map()
      const active = new Set()
      let frame = null
      let pendingTitles = true
      let disposed = false

      function revealHashTarget() {
        let id
        try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
        const target = id && document.getElementById(id)
        if (!target || !root.contains(target)) return
        records.forEach((kind, node) => {
          if (node === target || target.contains(node)) node.classList.add('edition-is-revealed')
        })
      }

      function update() {
        frame = null
        if (disposed || document.hidden) return
        const height = window.innerHeight || 1
        // Batch all layout reads before writing any styles.
        const measurements = []
        records.forEach((kind, node) => {
          if (active.has(node) || (kind === 'title' && !node.classList.contains('edition-is-revealed'))) {
            measurements.push({ node, kind, bounds: node.getBoundingClientRect() })
          }
        })
        for (const { node, kind, bounds } of measurements) {
          if (kind === 'title') {
            if (bounds.top < height * .94) node.classList.add('edition-is-revealed')
          } else if (kind === 'topics') {
            node.style.setProperty('--chapter-progress', clamp((height - bounds.top) / (height + bounds.height)).toFixed(4))
          } else {
            const distance = kind === 'feature' ? height * .7 : height * .58
            node.style.setProperty('--entry-progress', clamp((height * .96 - bounds.top) / distance).toFixed(4))
          }
        }
        pendingTitles = [...records].some(([node, kind]) => kind === 'title' && !node.classList.contains('edition-is-revealed'))
      }

      function schedule() {
        if (disposed || document.hidden || frame !== null || (!active.size && !pendingTitles)) return
        frame = window.requestAnimationFrame(update)
      }

      const observer = new window.IntersectionObserver((entries) => {
        for (const { target, isIntersecting } of entries) {
          if (isIntersecting) active.add(target)
          else active.delete(target)
          target.classList.toggle('edition-is-inview', isIntersecting)
        }
        schedule()
      }, { rootMargin: '10% 0px 10% 0px', threshold: 0 })

      function restoreNode(node, kind) {
        node.classList.remove(`edition-motion-${kind}`, 'edition-is-inview', 'edition-is-revealed')
        node.style.removeProperty('--entry-progress')
        node.style.removeProperty('--chapter-progress')
      }

      function discover() {
        records.forEach((kind, node) => {
          if (!root.contains(node)) {
            observer.unobserve(node)
            active.delete(node)
            restoreNode(node, kind)
            records.delete(node)
          }
        })
        for (const [selector, kind] of TARGETS) {
          root.querySelectorAll(selector).forEach((node) => {
            if (records.has(node)) return
            records.set(node, kind)
            node.classList.add(`edition-motion-${kind}`)
            observer.observe(node)
            if (kind === 'title') pendingTitles = true
          })
        }
        revealHashTarget()
        schedule()
      }

      function onHashChange() { revealHashTarget(); schedule() }
      function onFocus(event) {
        const target = event.target.closest?.('.edition-motion-story, .edition-motion-topic')
        if (target) {
          target.style.setProperty('--entry-progress', '1')
          target.classList.add('edition-is-revealed')
        }
      }
      function onVisibilityChange() {
        root.classList.toggle('edition-motion-paused', document.hidden)
        if (document.hidden) { window.cancelAnimationFrame(frame); frame = null }
        else schedule()
      }
      const watcher = typeof window.MutationObserver === 'function' ? new window.MutationObserver(discover) : null
      watcher?.observe(root, { childList: true, subtree: true })
      discover()
      root.classList.add('edition-choreography')
      onVisibilityChange()
      window.addEventListener('scroll', schedule, { passive: true })
      window.addEventListener('resize', schedule, { passive: true })
      window.addEventListener('hashchange', onHashChange)
      document.addEventListener('visibilitychange', onVisibilityChange)
      root.addEventListener('focusin', onFocus)

      dispose = () => {
        disposed = true
        window.cancelAnimationFrame(frame)
        observer.disconnect()
        watcher?.disconnect()
        window.removeEventListener('scroll', schedule)
        window.removeEventListener('resize', schedule)
        window.removeEventListener('hashchange', onHashChange)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        root.removeEventListener('focusin', onFocus)
        root.classList.remove('edition-choreography', 'edition-motion-paused')
        records.forEach((kind, node) => restoreNode(node, kind))
      }
    }

    function onPreferenceChange() { dispose(); start() }
    preference?.addEventListener?.('change', onPreferenceChange)
    start()
    return () => {
      dispose()
      preference?.removeEventListener?.('change', onPreferenceChange)
    }
  }, [enabled, ref])
}
