import { useEffect, useRef, useState } from 'react'
import '../../styles/intelligence-sculpture.css'

const FALLBACK = '/images/intelligence-edition/floating-ribbon.png'

// Kept outside React's render path: animation changes Three objects, never page state.
function buildSculpture(THREE, renderer) {
  const scene = new THREE.Scene()
  const resources = []
  const own = (resource) => { resources.push(resource); return resource }
  const dispose = () => {
    scene.environment = null
    resources.forEach((resource) => resource.dispose())
    scene.clear()
  }
  try {
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40)
    camera.position.set(0, 0, 6.4)
    const object = new THREE.Group()
    scene.add(object)

    const glassGeometry = own(new THREE.IcosahedronGeometry(1.48, 0))
    const glassMaterial = own(new THREE.MeshPhysicalMaterial({
      color: '#d6ef9c', metalness: 0, roughness: 0.065,
      transmission: 0.97, thickness: 1.2, ior: 1.38,
      clearcoat: 0.8, clearcoatRoughness: 0.06, envMapIntensity: 1.15,
      attenuationColor: '#98b64c', attenuationDistance: 3,
      flatShading: true,
    }))
    const glass = new THREE.Mesh(glassGeometry, glassMaterial)
    object.add(glass)

    const coreGeometry = own(new THREE.IcosahedronGeometry(0.26, 1))
    const metalMaterial = own(new THREE.MeshStandardMaterial({
      color: '#aab59c', metalness: 0.88, roughness: 0.27,
      envMapIntensity: 1.2,
    }))
    const core = new THREE.Mesh(coreGeometry, metalMaterial)
    object.add(core)

    const edgesGeometry = own(new THREE.EdgesGeometry(glassGeometry))
    const edgesMaterial = own(new THREE.LineBasicMaterial({ color: '#e0ff9e', transparent: true, opacity: 0.23 }))
    object.add(new THREE.LineSegments(edgesGeometry, edgesMaterial))

    const orbitGroup = new THREE.Group()
    const orbitGeometry = own(new THREE.TorusGeometry(0.91, 0.009, 6, 90))
    const orbitMaterial = own(new THREE.MeshStandardMaterial({ color: '#bec8a1', metalness: 0.85, roughness: 0.25, envMapIntensity: 1.1 }))
    for (let index = 0; index < 3; index += 1) {
      const orbit = new THREE.Mesh(orbitGeometry, orbitMaterial)
      orbit.rotation.set(index * 0.8 + 0.3, index * 1.1 + 0.5, index * 0.6)
      orbitGroup.add(orbit)
    }
    object.add(orbitGroup)

    scene.add(new THREE.HemisphereLight('#fff8dd', '#344224', 1.4))
    const key = new THREE.DirectionalLight('#fff9e9', 2.4)
    key.position.set(-3, 5, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#dcff98', 2.8)
    rim.position.set(4, 1, -2)
    scene.add(rim)

    // A small procedural studio gives glass and metal real reflections without a
    // downloaded HDRI. It is used only as an environment, never as the canvas background.
    const studio = new THREE.Scene()
    studio.background = new THREE.Color('#3d4c32')
    const panelGeometry = new THREE.PlaneGeometry(1, 1)
    const panels = [
      { color: '#fff8e8', intensity: 4.2, position: [-4, 3, 3], scale: [1.2, 4] },
      { color: '#edffc5', intensity: 3, position: [4, 1, 1], scale: [0.8, 4] },
      { color: '#ffffff', intensity: 3, position: [0, 5, -3], scale: [3, 1] },
    ].map(({ color, intensity, position, scale }) => {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
      const panel = new THREE.Mesh(panelGeometry, material)
      panel.position.set(...position)
      panel.scale.set(scale[0], scale[1], 1)
      panel.lookAt(0, 0, 0)
      studio.add(panel)
      return material
    })
    let pmrem
    try {
      pmrem = new THREE.PMREMGenerator(renderer)
      const environment = own(pmrem.fromScene(studio, 0.035, 0.1, 30, { size: 128 }))
      scene.environment = environment.texture
    } finally {
      pmrem?.dispose()
      panelGeometry.dispose()
      panels.forEach((material) => material.dispose())
      studio.clear()
    }

    return {
      scene, camera, object, core, orbitGroup,
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

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
      sculpture.object.rotation.set(0.2 + time * 0.11 + pointerY * 0.16 + progress * 0.55, time * 0.25 + pointerX * 0.22 + progress * 1.1, -0.18 + time * 0.055 - progress * 0.3)
      sculpture.object.position.y = Math.sin(time * 0.65) * 0.075 + progress * 0.3
      sculpture.object.scale.set(1 + progress * 0.12, 1 - progress * 0.14, 1 + progress * 0.08)
      sculpture.core.rotation.set(-time * 0.35, time * 0.48, 0.5)
      sculpture.orbitGroup.rotation.set(time * 0.1, -time * 0.2, time * 0.14)
      renderer.render(sculpture.scene, sculpture.camera)
      staticNeeded = false
    }
    const canRender = () => !cancelled && !failed && visible && !document.hidden && renderer && sculpture && width > 0 && height > 0
    const tick = (time) => {
      frame = null
      if (!canRender() || reduced || pausedRef.current) { lastTime = null; return }
      if (lastTime !== null) elapsed += Math.min((time - lastTime) / 1000, 0.05)
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setSize(width, height, false)
      sculpture.camera.aspect = width / height
      // Keep the full object inside narrow portrait slots as well as wide ones.
      sculpture.camera.position.z = 6.4 / Math.min(1, sculpture.camera.aspect)
      sculpture.camera.updateProjectionMatrix()
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
        renderer.toneMappingExposure = 0.95
        renderer.transmissionResolutionScale = 0.65
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.addEventListener('webglcontextlost', contextLost)
        sculpture = buildSculpture(THREE, renderer)
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
    <img className="intelligence-sculpture__fallback" src={FALLBACK} alt="" width="1536" height="1024" loading="lazy" decoding="async" />
  </div>
}
