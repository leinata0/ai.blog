import { useEffect } from 'react'

const clamp = (value) => Math.min(1, Math.max(0, value))
const smooth = (from, to, value) => { const t = clamp((value - from) / (to - from)); return t * t * (3 - 2 * t) }

export default function useEditionScene(ref, paused = false) {
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const stage = element.querySelector('.edition-hero__stage') || element
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const pointerPreference = window.matchMedia?.('(hover: hover) and (pointer: fine)')
    let frame = null
    let lastTime = null
    let visible = true
    let needsMeasure = true
    let targetProgress = 0
    let progress = Number.parseFloat(element.style.getPropertyValue('--scene-progress')) || 0
    let targetX = 0
    let targetY = 0
    let pointerX = Number.parseFloat(element.style.getPropertyValue('--pointer-x')) || 0
    let pointerY = Number.parseFloat(element.style.getPropertyValue('--pointer-y')) || 0
    const enabled = () => !paused && !preference?.matches && !document.hidden && visible
    const stop = () => { cancelAnimationFrame(frame); frame = null; lastTime = null; element.dataset.sceneActive = 'false' }
    const update = (time) => {
      frame = null
      if (!enabled()) return
      if (needsMeasure) {
        const bounds = element.getBoundingClientRect()
        targetProgress = clamp(-bounds.top / Math.max(1, bounds.height - stage.getBoundingClientRect().height))
        needsMeasure = false
      }
      const dt = lastTime === null ? 1 / 60 : Math.min(.05, (time - lastTime) / 1000)
      lastTime = time
      // Time-based damping continues after the wheel stops and eases reversals.
      const scrollEase = 1 - Math.exp(-dt / .14)
      const pointerEase = 1 - Math.exp(-dt / .19)
      progress += (targetProgress - progress) * scrollEase
      pointerX += (targetX - pointerX) * pointerEase
      pointerY += (targetY - pointerY) * pointerEase
      element.style.setProperty('--scene-progress', progress.toFixed(5))
      element.style.setProperty('--scene-cover', (1 - smooth(.02, .20, progress)).toFixed(5))
      element.style.setProperty('--scene-reveal', (smooth(.20, .38, progress) * (1 - smooth(.58, .78, progress))).toFixed(5))
      element.style.setProperty('--scene-wipe', smooth(.72, 1, progress).toFixed(5))
      element.style.setProperty('--scene-story', smooth(.58, .82, progress).toFixed(5))
      element.style.setProperty('--pointer-x', pointerX.toFixed(5))
      element.style.setProperty('--pointer-y', pointerY.toFixed(5))
      element.dataset.sceneCoverHidden = progress > .21 ? 'true' : 'false'
      element.dataset.sceneActive = 'true'
      const unsettled = Math.abs(targetProgress - progress) > .00015 || Math.abs(targetX - pointerX) + Math.abs(targetY - pointerY) > .001
      if (unsettled) frame = requestAnimationFrame(update)
      else lastTime = null
    }
    const schedule = () => { needsMeasure = true; if (frame === null && enabled()) frame = requestAnimationFrame(update) }
    const pointerMove = (event) => {
      if (event.pointerType === 'touch' || !pointerPreference?.matches || !enabled()) return
      const bounds = stage.getBoundingClientRect()
      targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
      targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
      schedule()
    }
    const pointerLeave = () => { targetX = 0; targetY = 0; schedule() }
    const syncPreference = () => {
      stop()
      element.dataset.sceneMotion = preference?.matches ? 'reduced' : 'full'
      if (preference?.matches) {
        element.dataset.sceneCoverHidden = 'false'
        for (const name of ['--scene-progress', '--scene-cover', '--scene-reveal', '--scene-wipe', '--scene-story', '--pointer-x', '--pointer-y']) element.style.removeProperty(name)
      } else schedule()
    }
    const syncVisibility = () => { if (document.hidden) stop(); else schedule() }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) schedule(); else stop()
    }) : null
    observer?.observe(element)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    stage.addEventListener('pointermove', pointerMove, { passive: true })
    stage.addEventListener('pointerleave', pointerLeave)
    document.addEventListener('visibilitychange', syncVisibility)
    preference?.addEventListener?.('change', syncPreference)
    syncPreference()
    return () => {
      stop()
      observer?.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      stage.removeEventListener('pointermove', pointerMove)
      stage.removeEventListener('pointerleave', pointerLeave)
      document.removeEventListener('visibilitychange', syncVisibility)
      preference?.removeEventListener?.('change', syncPreference)
    }
  }, [ref, paused])
}
