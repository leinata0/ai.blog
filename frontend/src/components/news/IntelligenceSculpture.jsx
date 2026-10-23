import { useEffect, useRef, useState } from 'react'
import buildRenaissanceWorld, { RENAISSANCE_ASSETS } from './buildRenaissanceWorld'
import '../../styles/intelligence-sculpture.css'

export default function IntelligenceSculpture({ sceneRef, paused = false }) {
  const hostRef = useRef(null)
  const pausedRef = useRef(paused)
  const syncRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof window.WebGL2RenderingContext !== 'function') return
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let reduced = Boolean(preference?.matches)
    let visible = typeof IntersectionObserver !== 'function'
    let cancelled = false
    let failed = false
    let assetsReady = false
    let firstDrawn = false
    let shaderFailed = false
    let renderer
    let sculpture
    let frame = null
    let lastTime = null
    let elapsed = 0
    let delta = 0
    let width = 0
    let height = 0
    let staticNeeded = true

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTime = null
    }
    const render = () => {
      if (!renderer || !sculpture) return
      const source = sceneRef?.current || host
      // The scene hook writes inline CSS properties, so reading its style avoids
      // forcing layout on every animation frame.
      const read = (name, min, max) => {
        const value = Number.parseFloat(source.style.getPropertyValue(name))
        return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0
      }
      const progress = reduced ? 0 : read('--scene-progress', 0, 1)
      const pointerX = reduced ? 0 : read('--pointer-x', -1, 1)
      const pointerY = reduced ? 0 : read('--pointer-y', -1, 1)
      const time = reduced ? 0 : elapsed
      sculpture.update({ elapsed: time, delta: reduced || pausedRef.current ? 0 : delta, progress, pointerX, pointerY, reduced })
      renderer.render(sculpture.scene, sculpture.camera)
      if (shaderFailed) throw new Error('The world shader could not be rendered')
      if (!firstDrawn) { firstDrawn = true; setReady(true) }
      staticNeeded = false
    }
    const canRender = () => !cancelled && !failed && assetsReady && visible && !document.hidden && renderer && sculpture && width > 0 && height > 0
    const tick = (time) => {
      frame = null
      if (!canRender() || reduced || pausedRef.current) { lastTime = null; return }
      delta = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05)
      elapsed += delta
      lastTime = time
      try { render() } catch { fail(); return }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      if (!canRender()) { stop(); return }
      if (reduced || pausedRef.current) {
        stop()
        if (staticNeeded) {
          try { render() } catch { fail() }
        }
      } else if (frame === null) frame = requestAnimationFrame(tick)
    }
    const resize = () => {
      if (!renderer || !sculpture) return
      const bounds = host.getBoundingClientRect()
      width = Math.max(0, bounds.width)
      height = Math.max(0, bounds.height)
      if (!width || !height) { stop(); return }
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25)
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      sculpture.resize(width, height, dpr)
      staticNeeded = true
      sync()
    }
    const fail = () => {
      failed = true
      stop()
      release()
      if (!cancelled) setReady(false)
    }
    const contextLost = (event) => {
      event.preventDefault()
      fail()
    }
    const release = () => {
      sculpture?.dispose()
      sculpture = null
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', contextLost)
        renderer.dispose()
        renderer.forceContextLoss()
        renderer.domElement.remove()
        renderer = null
      }
    }
    const onPreference = () => {
      reduced = Boolean(preference?.matches)
      staticNeeded = true
      sync()
    }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      sync()
    }, { threshold: 0 }) : null
    observer?.observe(host)
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(host)
    if (!resizeObserver) window.addEventListener('resize', resize, { passive: true })
    document.addEventListener('visibilitychange', sync)
    preference?.addEventListener?.('change', onPreference)
    syncRef.current = () => { staticNeeded = true; sync() }

    // Dynamic import keeps the renderer out of article/private route startup and
    // is safe when this decorative component is rendered during prerendering.
    import('three').then((THREE) => {
      if (cancelled) return
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
        renderer.setClearColor(0x000000, 0)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1
        if (renderer.debug) renderer.debug.onShaderError = () => { shaderFailed = true }
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.addEventListener('webglcontextlost', contextLost)
        sculpture = buildRenaissanceWorld(THREE, renderer)
        host.appendChild(renderer.domElement)
        resize()
        sculpture.ready.then((loaded) => {
          if (cancelled || failed || !loaded) return
          assetsReady = true
          resize()
        }).catch(fail)
      } catch {
        fail()
      }
    }).catch(fail)

    return () => {
      cancelled = true
      stop()
      observer?.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', sync)
      preference?.removeEventListener?.('change', onPreference)
      syncRef.current = null
      release()
    }
  }, [sceneRef])

  useEffect(() => {
    pausedRef.current = paused
    syncRef.current?.()
  }, [paused])

  return <div ref={hostRef} className={`intelligence-sculpture${ready ? ' intelligence-sculpture--ready' : ''}`} aria-hidden="true">
    <div className="intelligence-sculpture__fallback" data-fallback="renaissance-world">
      <div className="intelligence-sculpture__garden" style={{ backgroundImage: `url(${RENAISSANCE_ASSETS.world})` }} />
      <div className="intelligence-sculpture__figure intelligence-sculpture__figure--left"><img src={RENAISSANCE_ASSETS.figures} alt="" width="1672" height="941" decoding="async" /></div>
      <div className="intelligence-sculpture__figure intelligence-sculpture__figure--right"><img src={RENAISSANCE_ASSETS.figures} alt="" width="1672" height="941" decoding="async" /></div>
    </div>
  </div>
}
