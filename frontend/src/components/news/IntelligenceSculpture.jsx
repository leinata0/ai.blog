import { useEffect, useRef, useState } from 'react'
import buildSignalObservatory from './buildSignalObservatory'
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
      staticNeeded = false
    }
    const canRender = () => !cancelled && !failed && visible && !document.hidden && renderer && sculpture && width > 0 && height > 0
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
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
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
        renderer.toneMappingExposure = 1.05
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.addEventListener('webglcontextlost', contextLost)
        sculpture = buildSignalObservatory(THREE, renderer)
        host.appendChild(renderer.domElement)
        resize()
        if (!failed) setReady(true)
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
    <svg className="intelligence-sculpture__fallback" data-fallback="signal-observatory" viewBox="0 0 1000 800" focusable="false">
      {Array.from({ length: 40 }, (_, index) => <circle key={index} cx={(index * 197 + 53) % 1000} cy={(index * 137 + 29) % 800} r={index % 3 === 0 ? 1.8 : 0.9} fill="#90bdff" opacity=".5" />)}
      <g transform="translate(650 350) rotate(-18)">
        <path d="M-24 100L-24 260H-100V280H100V260H24V100" fill="#344d6b" stroke="#8da9c4" strokeWidth="3" />
        <path d="M-230 0Q0 310 230 0Q0 155-230 0" fill="#3b5571" stroke="#a0bad3" strokeWidth="4" />
        <ellipse rx="230" ry="140" fill="#bacddd" stroke="#e1ecf6" strokeWidth="6" />
        {[-170, -110, -55, 0, 55, 110, 170].map((x) => <ellipse key={x} cx={x / 3} rx={Math.sqrt(230 ** 2 - x ** 2)} ry={Math.max(15, 140 - Math.abs(x) / 2)} fill="none" stroke="#718ea8" strokeWidth="1" opacity=".6" />)}
        <path d="M-215-45L0-120L180 85M0-120L-25 138" fill="none" stroke="#e0edfa" strokeWidth="5" />
        <path d="M-20-144H20V-99H-20Z" fill="#237dc6" stroke="#9be6ff" strokeWidth="3" />
        <ellipse cy="-144" rx="20" ry="7" fill="#79dfff" />
      </g>
    </svg>
  </div>
}
