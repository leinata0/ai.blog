import { useEffect } from 'react'
import { ensureEditionSceneState } from '../utils/editionSceneState'

const clamp = (value) => Math.min(1, Math.max(0, value))
const smooth = (from, to, value) => { const t = clamp((value - from) / (to - from)); return t * t * (3 - 2 * t) }

function leafWriter(element, selector, property) {
  const leaves = [...element.querySelectorAll(selector)].map((node) => ({
    node, previous: node.style.getPropertyValue(property),
  }))
  return (value) => {
    const next = value.toFixed(5)
    for (const leaf of leaves) {
      if (leaf.previous === next) continue
      leaf.node.style.setProperty(property, next)
      leaf.previous = next
    }
  }
}

export default function useEditionScene(ref, paused = false) {
  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    const stage = element.querySelector('.edition-hero__stage') || element
    const state = ensureEditionSceneState(element)
    const writeCover = leafWriter(element, '.edition-cover', '--scene-cover')
    const writeReveal = leafWriter(element, '.edition-hero__masthead, .edition-hero__chapter', '--scene-reveal')
    const writeWipe = leafWriter(element, '.edition-hero__light-wash, .edition-hero__foot', '--scene-wipe')
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const pointerPreference = window.matchMedia?.('(hover: hover) and (pointer: fine)')
    let frame = null
    let lastTime = null
    let visible = true
    let geometryDirty = true
    let stageBounds = null
    let latestPointer = null
    let pointerDirty = false
    let targetProgress = state.progress
    let targetX = state.pointerX
    let targetY = state.pointerY
    const enabled = () => !paused && !preference?.matches && !document.hidden && visible
    const setDataset = (name, value) => { if (element.dataset[name] !== value) element.dataset[name] = value }
    const writePose = () => {
      writeCover(1 - smooth(.02, .20, state.progress))
      writeReveal(smooth(.20, .38, state.progress) * (1 - smooth(.58, .78, state.progress)))
      writeWipe(smooth(.72, 1, state.progress))
      setDataset('sceneCoverHidden', state.progress > .21 ? 'true' : 'false')
    }
    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTime = null
      setDataset('sceneActive', 'false')
    }
    const update = (time) => {
      frame = null
      if (!enabled()) return
      if (geometryDirty) {
        const bounds = element.getBoundingClientRect()
        stageBounds = stage.getBoundingClientRect()
        targetProgress = clamp(-bounds.top / Math.max(1, bounds.height - stageBounds.height))
        geometryDirty = false
        pointerDirty = true
      }
      if (pointerDirty && latestPointer && stageBounds) {
        targetX = Math.max(-1, Math.min(1, (latestPointer.x - stageBounds.left) / Math.max(1, stageBounds.width) * 2 - 1))
        targetY = Math.max(-1, Math.min(1, (latestPointer.y - stageBounds.top) / Math.max(1, stageBounds.height) * 2 - 1))
      }
      pointerDirty = false
      const dt = lastTime === null ? 1 / 60 : Math.max(0, Math.min(.1, (time - lastTime) / 1000))
      lastTime = time
      // One time-based filter follows input; renderers consume this pose directly.
      const scrollEase = 1 - Math.exp(-dt / .09)
      const pointerEase = 1 - Math.exp(-dt / .11)
      state.progress += (targetProgress - state.progress) * scrollEase
      state.pointerX += (targetX - state.pointerX) * pointerEase
      state.pointerY += (targetY - state.pointerY) * pointerEase
      writePose()
      setDataset('sceneActive', 'true')
      const unsettled = Math.abs(targetProgress - state.progress) > .00015 || Math.abs(targetX - state.pointerX) + Math.abs(targetY - state.pointerY) > .001
      if (unsettled) frame = requestAnimationFrame(update)
      else lastTime = null
    }
    const schedule = () => { if (frame === null && enabled()) frame = requestAnimationFrame(update) }
    const invalidateGeometry = () => { geometryDirty = true; schedule() }
    const pointerMove = (event) => {
      if (event.pointerType === 'touch' || !pointerPreference?.matches || !enabled()) return
      latestPointer = { x: event.clientX, y: event.clientY }
      pointerDirty = true
      schedule()
    }
    const pointerLeave = () => { latestPointer = null; targetX = 0; targetY = 0; schedule() }
    const syncPreference = () => {
      stop()
      setDataset('sceneMotion', preference?.matches ? 'reduced' : 'full')
      if (preference?.matches) {
        state.progress = 0
        state.pointerX = 0
        state.pointerY = 0
        targetX = 0
        targetY = 0
        latestPointer = null
        writePose()
      } else invalidateGeometry()
    }
    const syncVisibility = () => { if (document.hidden) stop(); else invalidateGeometry() }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) invalidateGeometry(); else stop()
    }) : null
    observer?.observe(element)
    window.addEventListener('scroll', invalidateGeometry, { passive: true })
    window.addEventListener('resize', invalidateGeometry, { passive: true })
    stage.addEventListener('pointermove', pointerMove, { passive: true })
    stage.addEventListener('pointerleave', pointerLeave)
    document.addEventListener('visibilitychange', syncVisibility)
    preference?.addEventListener?.('change', syncPreference)
    syncPreference()
    return () => {
      stop()
      observer?.disconnect()
      window.removeEventListener('scroll', invalidateGeometry)
      window.removeEventListener('resize', invalidateGeometry)
      stage.removeEventListener('pointermove', pointerMove)
      stage.removeEventListener('pointerleave', pointerLeave)
      document.removeEventListener('visibilitychange', syncVisibility)
      preference?.removeEventListener?.('change', syncPreference)
    }
  }, [ref, paused])
}
