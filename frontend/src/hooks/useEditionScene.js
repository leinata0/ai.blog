import { useEffect } from 'react'

export default function useEditionScene(ref) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let frame = null
    let visible = true
    const update = () => {
      frame = null
      if (preference?.matches || !visible) return
      const bounds = element.getBoundingClientRect()
      const progress = Math.min(1, Math.max(0, -bounds.top / Math.max(1, bounds.height)))
      element.style.setProperty('--scene-progress', progress.toFixed(4))
    }
    const schedule = () => {
      if (!frame && visible && !preference?.matches) frame = requestAnimationFrame(update)
    }
    const reset = () => {
      element.style.removeProperty('--scene-progress')
      if (!preference?.matches) schedule()
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) schedule()
      else { cancelAnimationFrame(frame); frame = null }
    }) : null
    observer?.observe(element)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    preference?.addEventListener?.('change', reset)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      preference?.removeEventListener?.('change', reset)
    }
  }, [ref])
}
