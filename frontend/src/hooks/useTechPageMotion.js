import { useEffect } from 'react'

/** One-shot entries and a single pointer-controlled plane, with no React frames. */
export default function useTechPageMotion(ref) {
  useEffect(() => {
    const root = ref.current
    if (!root) return undefined
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let dispose = () => {}

    function start() {
      if (reduce?.matches) return
      const pending = new Set()
      const seen = new WeakSet()
      const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
        entries.forEach(({ target, isIntersecting }) => {
          if (!isIntersecting) return
          target.removeAttribute('data-tech-pending')
          pending.delete(target)
          observer.unobserve(target)
        })
      }, { threshold: 0.08 }) : null
      const discover = () => {
        pending.forEach((node) => {
          if (root.contains(node)) return
          pending.delete(node)
          observer?.unobserve(node)
        })
        root.querySelectorAll('[data-tech-reveal]').forEach((node) => {
          if (!observer || seen.has(node)) return
          seen.add(node)
          node.setAttribute('data-tech-pending', '')
          pending.add(node)
          observer.observe(node)
        })
        revealHash()
      }
      const watcher = observer && typeof MutationObserver === 'function' ? new MutationObserver(discover) : null
      watcher?.observe(root, { childList: true, subtree: true })
      discover()

      function revealFocused(event) {
        const node = event.target.closest?.('[data-tech-pending]')
        if (!node) return
        node.removeAttribute('data-tech-pending')
        pending.delete(node)
        observer?.unobserve(node)
      }
      function revealHash() {
        let id
        try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
        const target = id && document.getElementById(id)
        if (!target || !root.contains(target)) return
        pending.forEach((node) => {
          if (node === target || target.contains(node) || node.contains(target)) {
            node.removeAttribute('data-tech-pending')
            pending.delete(node)
            observer?.unobserve(node)
          }
        })
      }
      revealHash()
      root.addEventListener('focusin', revealFocused)
      window.addEventListener('hashchange', revealHash)

      const plane = root.querySelector('.tech-page-hero__visual')
      const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches
      let frame = null
      let point = null
      function applyTilt() {
        frame = null
        if (!point || !plane) return
        const bounds = plane.getBoundingClientRect()
        const x = Math.max(-0.5, Math.min(0.5, (point.x - bounds.left) / Math.max(1, bounds.width) - 0.5))
        const y = Math.max(-0.5, Math.min(0.5, (point.y - bounds.top) / Math.max(1, bounds.height) - 0.5))
        plane.style.setProperty('--scene-rx', `${(-y * 7).toFixed(2)}deg`)
        plane.style.setProperty('--scene-ry', `${(x * 9).toFixed(2)}deg`)
      }
      function onMove(event) {
        if (document.hidden || event.pointerType === 'touch') return
        point = { x: event.clientX, y: event.clientY }
        if (frame === null) frame = requestAnimationFrame(applyTilt)
      }
      function resetTilt() {
        cancelAnimationFrame(frame)
        frame = null
        point = null
        plane?.style.removeProperty('--scene-rx')
        plane?.style.removeProperty('--scene-ry')
      }
      if (finePointer) {
        plane?.addEventListener('pointermove', onMove, { passive: true })
        plane?.addEventListener('pointerleave', resetTilt)
        document.addEventListener('visibilitychange', resetTilt)
      }
      dispose = () => {
        observer?.disconnect()
        watcher?.disconnect()
        pending.forEach((node) => node.removeAttribute('data-tech-pending'))
        root.removeEventListener('focusin', revealFocused)
        window.removeEventListener('hashchange', revealHash)
        plane?.removeEventListener('pointermove', onMove)
        plane?.removeEventListener('pointerleave', resetTilt)
        document.removeEventListener('visibilitychange', resetTilt)
        resetTilt()
      }
    }
    function onPreferenceChange() { dispose(); start() }
    start()
    reduce?.addEventListener?.('change', onPreferenceChange)
    return () => { dispose(); reduce?.removeEventListener?.('change', onPreferenceChange) }
  }, [ref])
}
