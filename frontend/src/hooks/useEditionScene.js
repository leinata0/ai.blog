import { useEffect } from 'react'

const clamp = (value) => Math.min(1, Math.max(0, value))

export default function useEditionScene(ref, paused = false) {
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const stage = element.querySelector('.edition-hero__stage') || element
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const pointerPreference = window.matchMedia?.('(hover: hover) and (pointer: fine)')
    let frame = null
    let visible = true
    let targetX = 0
    let targetY = 0
    let pointerX = 0
    let pointerY = 0
    const enabled = () => !paused && !preference?.matches && !document.hidden && visible
    const stop = () => { cancelAnimationFrame(frame); frame = null; element.dataset.sceneActive = 'false' }
    const update = () => {
      frame = null
      if (!enabled()) return
      const bounds = element.getBoundingClientRect()
      const travel = Math.max(1, bounds.height - stage.getBoundingClientRect().height)
      const progress = clamp(-bounds.top / travel)
      pointerX += (targetX - pointerX) * .12
      pointerY += (targetY - pointerY) * .12
      element.style.setProperty('--scene-progress', progress.toFixed(4))
      element.style.setProperty('--scene-cover', clamp(1 - progress / .26).toFixed(4))
      element.style.setProperty('--scene-reveal', clamp((progress - .15) / .23).toFixed(4))
      element.style.setProperty('--scene-wipe', clamp((progress - .67) / .33).toFixed(4))
      element.style.setProperty('--pointer-x', pointerX.toFixed(4))
      element.style.setProperty('--pointer-y', pointerY.toFixed(4))
      element.dataset.sceneCoverHidden = progress > .28 ? 'true' : 'false'
      element.dataset.sceneActive = 'true'
      if (Math.abs(targetX - pointerX) + Math.abs(targetY - pointerY) > .002) frame = requestAnimationFrame(update)
    }
    const schedule = () => { if (frame === null && enabled()) frame = requestAnimationFrame(update) }
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
        for (const name of ['--scene-progress', '--scene-cover', '--scene-reveal', '--scene-wipe', '--pointer-x', '--pointer-y']) element.style.removeProperty(name)
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
