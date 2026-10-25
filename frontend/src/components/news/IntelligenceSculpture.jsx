import { useEffect, useRef, useState } from 'react'
import buildRenaissanceWorld, { RENAISSANCE_ASSETS } from './buildRenaissanceWorld'
import { getEditionSceneState } from '../../utils/editionSceneState'
import { createSceneResolutionController, scenePixelRatio } from '../../utils/sceneResolution'
import { optimizedImageUrl } from '../../utils/responsiveImage'
import { PERFORMANCE_TRIAL_ENABLED } from '../../utils/performanceTrial'
import { createSceneStartup } from '../../utils/sceneStartup'
import '../../styles/intelligence-sculpture.css'

export default function IntelligenceSculpture({ sceneRef, paused = false }) {
  const hostRef = useRef(null)
  const pausedRef = useRef(paused)
  const syncRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [failedAssets, setFailedAssets] = useState({})
  const artwork = (key) => failedAssets[key] ? RENAISSANCE_ASSETS[key] : optimizedImageUrl(RENAISSANCE_ASSETS[key])
  const originalArtwork = (key) => setFailedAssets((previous) => previous[key] ? previous : { ...previous, [key]: true })

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof window.WebGL2RenderingContext !== 'function') return
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let reduced = Boolean(preference?.matches)
    let visible = typeof IntersectionObserver !== 'function'
    let cancelled = false
    let failed = false
    let assetsReady = false
    let firstPresented = false
    let shaderFailed = false
    let renderer
    let sculpture
    let startup
    let frame = null
    let lastTime = null
    let elapsed = 0
    let delta = 0
    let width = 0
    let height = 0
    let staticNeeded = true
    let drewContent = false
    let appliedWidth = 0
    let appliedHeight = 0
    let pixelRatio = 0
    const resolution = createSceneResolutionController()

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTime = null
    }
    const presented = () => {
      if (!firstPresented) { firstPresented = true; setReady(true) }
      staticNeeded = false
    }
    const render = () => {
      if (!renderer || !sculpture) return
      const source = sceneRef?.current || host
      const pose = getEditionSceneState(source)
      const progress = reduced ? 0 : pose?.progress ?? 0
      const pointerX = reduced ? 0 : pose?.pointerX ?? 0
      const pointerY = reduced ? 0 : pose?.pointerY ?? 0
      const time = reduced ? 0 : elapsed
      sculpture.update({ elapsed: time, delta: reduced || pausedRef.current ? 0 : delta, progress, pointerX, pointerY, reduced })
      if (sculpture.hasVisibleContent === false) {
        // Clear the previous pose once, then stop submitting an empty scene.
        // update still runs so reverse scrolling can restore it immediately.
        // A cold start at a restored scroll position may already be empty;
        // present that clear frame too so static fallback art does not linger.
        if (drewContent || !firstPresented) renderer.clear()
        drewContent = false
        presented()
        return
      }
      renderer.render(sculpture.scene, sculpture.camera)
      drewContent = true
      if (shaderFailed) throw new Error('The world shader could not be rendered')
      presented()
    }
    const canRender = () => !cancelled && !failed && assetsReady && visible && !document.hidden && renderer && sculpture && width > 0 && height > 0
    const tick = (time) => {
      frame = null
      if (!canRender() || reduced || pausedRef.current) { lastTime = null; return }
      const interval = lastTime === null ? 0 : time - lastTime
      delta = Math.min(interval / 1000, 0.1)
      elapsed += delta
      lastTime = time
      try {
        if (resolution.sample(interval)) applySize()
        render()
      } catch { fail(); return }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      startup?.sync()
      if (!canRender()) { stop(); return }
      if (reduced || pausedRef.current) {
        stop()
        if (staticNeeded) {
          try { render() } catch { fail() }
        }
      } else if (frame === null) frame = requestAnimationFrame(tick)
    }
    const applySize = () => {
      const dpr = scenePixelRatio(width, height, window.devicePixelRatio, resolution.quality)
      if (pixelRatio === dpr && appliedWidth === width && appliedHeight === height) return
      pixelRatio = dpr
      appliedWidth = width
      appliedHeight = height
      renderer.setPixelRatio(dpr)
      renderer.setSize(width, height, false)
      sculpture.resize(width, height, dpr)
      staticNeeded = true
    }
    const resize = () => {
      if (!renderer || !sculpture) return
      const bounds = host.getBoundingClientRect()
      width = Math.max(0, bounds.width)
      height = Math.max(0, bounds.height)
      if (!width || !height) { stop(); return }
      applySize()
      sync()
    }
    const fail = () => {
      failed = true
      startup?.dispose()
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

    // Keep the accepted scene intact while letting text and fallback art paint
    // before the trial allocates a visible WebGL renderer.
    startup = createSceneStartup({
      deferred: PERFORMANCE_TRIAL_ENABLED,
      isEligible: () => !cancelled && !failed && visible && !document.hidden,
      load: () => import('three'),
      start: (THREE) => {
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
      },
      onError: fail,
    })
    startup.sync()

    return () => {
      cancelled = true
      startup.dispose()
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
      <img className="intelligence-sculpture__garden" src={artwork('world')} onError={() => originalArtwork('world')} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" width="1672" height="941" decoding="async" />
      <div className="intelligence-sculpture__figure intelligence-sculpture__figure--left"><img src={artwork('figures')} onError={() => originalArtwork('figures')} alt="" width="1672" height="941" decoding="async" /></div>
      <div className="intelligence-sculpture__figure intelligence-sculpture__figure--right"><img src={artwork('figures')} onError={() => originalArtwork('figures')} alt="" width="1672" height="941" decoding="async" /></div>
    </div>
  </div>
}
