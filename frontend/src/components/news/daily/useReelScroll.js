import { useCallback, useEffect, useRef } from 'react'

const stops = [0, .5, .94]
const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'])

// Animate only a deliberate chapter jump. Ordinary wheel/touch scrolling stays
// native, and a new input immediately gives control back to the reader.
export default function useReelScroll(track) {
  const running = useRef(null)
  const cancel = useCallback(() => {
    if (running.current) cancelAnimationFrame(running.current.frame)
    running.current = null
  }, [])

  useEffect(() => {
    const keydown = (event) => { if (scrollKeys.has(event.key)) cancel() }
    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchstart', cancel, { passive: true })
    window.addEventListener('keydown', keydown)
    window.addEventListener('resize', cancel)
    return () => {
      cancel()
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('resize', cancel)
    }
  }, [cancel])

  return useCallback((destination) => {
    // Relative controls can reverse a pending jump before the visible chapter
    // has changed, instead of wrapping around from the old chapter number.
    const index = typeof destination === 'function' ? destination(running.current?.index) : destination
    cancel()
    const element = track.current
    if (!element || stops[index] === undefined) return
    const from = window.scrollY
    const start = from + element.getBoundingClientRect().top
    const travel = Math.max(0, element.offsetHeight - window.innerHeight)
    const target = start + travel * stops[index]
    const distance = target - from
    if (Math.abs(distance) < 1) return
    const duration = Math.min(780, 540 + Math.abs(distance) * .08)
    const animation = { index, frame: 0, started: performance.now() }
    running.current = animation
    const frame = (now) => {
      if (running.current !== animation) return
      const progress = Math.min(1, Math.max(0, (now - animation.started) / duration))
      const eased = (1 - Math.cos(Math.PI * progress)) / 2
      // The site has global smooth scrolling; each animation frame must bypass
      // it instead of starting another browser-controlled smooth scroll.
      window.scrollTo({ top: from + distance * eased, behavior: 'instant' })
      if (progress < 1) animation.frame = requestAnimationFrame(frame)
      else running.current = null
    }
    animation.frame = requestAnimationFrame(frame)
  }, [track, cancel])
}
