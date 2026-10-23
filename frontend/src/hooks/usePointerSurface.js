import { useEffect, useRef } from 'react'

// Pointer feedback updates only CSS variables, without rerendering article content.
export default function usePointerSurface() {
  const frame = useRef(null)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  function onPointerMove(event) {
    if (event.pointerType === 'touch' || frame.current) return
    const target = event.currentTarget
    const bounds = target.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / Math.max(1, bounds.width)
    const y = (event.clientY - bounds.top) / Math.max(1, bounds.height)
    frame.current = requestAnimationFrame(() => {
      target.style.setProperty('--pointer-x', `${x * 100}%`)
      target.style.setProperty('--pointer-y', `${y * 100}%`)
      target.style.setProperty('--tilt-x', `${(y - .5) * -4}deg`)
      target.style.setProperty('--tilt-y', `${(x - .5) * 4}deg`)
      frame.current = null
    })
  }
  function onPointerLeave(event) {
    cancelAnimationFrame(frame.current)
    frame.current = null
    for (const key of ['--pointer-x', '--pointer-y', '--tilt-x', '--tilt-y']) event.currentTarget.style.removeProperty(key)
  }
  return { onPointerMove, onPointerLeave }
}
