import { useEffect, useRef, useState } from 'react'

// News covers live in the DOM above this sculpture. Keeping them out of the
// WebGL scene preserves crisp, accessible images and avoids CDN/CORS failures.
function makeSculpture(THREE, renderer, mode) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 40)
  camera.position.set(0, 0.58, 9.2)
  camera.lookAt(0, 0.04, 0)
  const objects = new Set()
  const materials = new Set()
  const geometry = (item) => { objects.add(item); return item }
  const material = (item) => { materials.add(item); return item }
  const blue = mode === 'weekly' ? 0x4a39d3 : mode === 'topics' ? 0x126795 : 0x2449ec

  // A tiny, generated studio map gives silver a real reflection without an HDR
  // download, postprocessing, realtime shadows or additional render passes.
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 0, 256)
  gradient.addColorStop(0, '#edf1ff')
  gradient.addColorStop(0.4, '#a9b4cc')
  gradient.addColorStop(0.54, '#29344e')
  gradient.addColorStop(0.61, '#f8fbff')
  gradient.addColorStop(1, '#969da6')
  context.fillStyle = gradient
  context.fillRect(0, 0, 512, 256)
  context.fillStyle = '#ffffff'
  context.fillRect(45, 28, 80, 139)
  context.fillRect(286, 12, 32, 152)
  context.fillStyle = '#455475'
  context.fillRect(185, 32, 24, 150)
  const environmentTexture = new THREE.CanvasTexture(canvas)
  environmentTexture.mapping = THREE.EquirectangularReflectionMapping
  environmentTexture.colorSpace = THREE.SRGBColorSpace
  const generator = new THREE.PMREMGenerator(renderer)
  const environment = generator.fromEquirectangular(environmentTexture)
  scene.environment = environment.texture
  environmentTexture.dispose()
  generator.dispose()

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8893a8, 2.3))
  const keyLight = new THREE.DirectionalLight(0xffffff, 4.1)
  keyLight.position.set(-3, 5, 6)
  scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0x8cafff, 2.6)
  rimLight.position.set(4, 0, -3)
  scene.add(rimLight)

  const chrome = material(new THREE.MeshStandardMaterial({ color: 0xe5e9f4, metalness: 0.98, roughness: 0.19, envMapIntensity: 1.4 }))
  const satin = material(new THREE.MeshStandardMaterial({ color: 0xc7cdd8, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.2 }))
  const enamel = material(new THREE.MeshStandardMaterial({ color: blue, metalness: 0.58, roughness: 0.2, envMapIntensity: 1.1 }))
  const glass = material(new THREE.MeshStandardMaterial({ color: 0x729bff, metalness: 0.18, roughness: 0.16, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }))
  const darkBlue = material(new THREE.MeshStandardMaterial({ color: 0x152c86, metalness: 0.7, roughness: 0.25 }))
  const assembly = new THREE.Group()
  scene.add(assembly)

  const mesh = (shape, finish, parent = assembly) => {
    const result = new THREE.Mesh(geometry(shape), finish)
    parent.add(result)
    return result
  }
  const torus = (radius, thickness, finish, parent = assembly, arc = Math.PI * 2) => mesh(new THREE.TorusGeometry(radius, thickness, 10, 96, arc), finish, parent)
  const lens = new THREE.Group()
  lens.rotation.set(0.13, -0.32, -0.21)
  lens.position.set(0, 0.14, 0.02)
  assembly.add(lens)

  // A machined, thick outer bezel. The profile has flat faces and chamfered
  // edges, so it reads as an object rather than a stroked circle.
  const profile = [
    [1.43, -0.17], [1.49, -0.23], [1.67, -0.23], [1.74, -0.16],
    [1.74, 0.1], [1.67, 0.18], [1.49, 0.18], [1.43, 0.12], [1.43, -0.17],
  ].map(([radius, height]) => new THREE.Vector2(radius, height))
  const bezel = mesh(new THREE.LatheGeometry(profile, 96), enamel, lens)
  bezel.rotation.x = Math.PI / 2
  const faceRim = torus(1.47, 0.035, chrome, lens)
  faceRim.position.z = 0.21
  const backRim = torus(1.68, 0.022, chrome, lens)
  backRim.position.z = -0.23
  const lensDisc = mesh(new THREE.SphereGeometry(1.42, 40, 20), glass, lens)
  lensDisc.scale.z = 0.12
  lensDisc.position.z = -0.11

  // The orbit is offset in space, exposing both its near and far sides.
  const silverOrbit = new THREE.Group()
  silverOrbit.rotation.set(0.65, -0.31, 0.38)
  silverOrbit.position.y = 0.13
  assembly.add(silverOrbit)
  torus(2.14, 0.065, chrome, silverOrbit)
  const secondRail = torus(2.23, 0.019, satin, silverOrbit)
  secondRail.position.z = -0.035
  const orbitBlue = new THREE.Group()
  orbitBlue.rotation.set(-0.54, 0.64, -0.61)
  orbitBlue.position.set(0.05, 0.16, -0.12)
  assembly.add(orbitBlue)
  const blueArc = torus(2.05, 0.105, enamel, orbitBlue, Math.PI * 1.32)
  blueArc.rotation.z = 0.46
  const silverArc = torus(2.05, 0.038, chrome, orbitBlue, Math.PI * 0.39)
  silverArc.rotation.z = Math.PI * 1.57

  // Three physical joints, not clouds of particles or meaningless data marks.
  const boltShape = geometry(new THREE.CylinderGeometry(0.09, 0.09, 0.19, 12))
  for (let index = 0; index < 3; index += 1) {
    const angle = index * Math.PI * 2 / 3 + 0.3
    const bolt = new THREE.Mesh(boltShape, chrome)
    bolt.rotation.x = Math.PI / 2
    bolt.position.set(Math.cos(angle) * 2.14, Math.sin(angle) * 2.14, 0)
    silverOrbit.add(bolt)
    const mount = mesh(new THREE.BoxGeometry(0.31, 0.16, 0.13), enamel, silverOrbit)
    mount.position.copy(bolt.position)
    mount.rotation.z = angle
  }

  const crystals = new THREE.Group()
  assembly.add(crystals)
  const cutShape = new THREE.Shape()
  cutShape.moveTo(-0.29, -0.68)
  cutShape.lineTo(0.26, -0.42)
  cutShape.lineTo(0.38, 0.53)
  cutShape.lineTo(-0.12, 0.8)
  cutShape.lineTo(-0.29, -0.68)
  const cutGeometry = geometry(new THREE.ExtrudeGeometry(cutShape, { depth: 0.17, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.025, bevelSegments: 1, steps: 1 }))
  const crystal = new THREE.Mesh(cutGeometry, glass)
  crystal.position.set(1.98, -0.4, 0.35)
  crystal.rotation.set(0.2, -0.5, -0.43)
  crystals.add(crystal)
  const crystalFrame = mesh(new THREE.BoxGeometry(0.035, 1.22, 0.09), chrome, crystals)
  crystalFrame.position.set(1.78, -0.36, 0.37)
  crystalFrame.rotation.z = -0.52
  const smallerCut = new THREE.Mesh(cutGeometry, enamel)
  smallerCut.position.set(-1.79, 0.88, -0.12)
  smallerCut.scale.set(0.55, 0.65, 0.65)
  smallerCut.rotation.set(0.1, 0.55, -0.7)
  crystals.add(smallerCut)

  const pedestal = new THREE.Group()
  pedestal.position.set(0, -2.12, -0.05)
  scene.add(pedestal)
  mesh(new THREE.CylinderGeometry(1.42, 1.57, 0.17, 80), satin, pedestal)
  const plinth = mesh(new THREE.CylinderGeometry(1.27, 1.42, 0.13, 80), chrome, pedestal)
  plinth.position.y = 0.13
  const bottomLip = mesh(new THREE.CylinderGeometry(1.58, 1.58, 0.04, 80), darkBlue, pedestal)
  bottomLip.position.y = -0.08

  // A small radial contact shadow is a single cheap transparent plane.
  const shadowCanvas = document.createElement('canvas')
  shadowCanvas.width = shadowCanvas.height = 64
  const shadowContext = shadowCanvas.getContext('2d')
  const shadowGradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32)
  shadowGradient.addColorStop(0, 'rgba(34,42,59,0.24)')
  shadowGradient.addColorStop(1, 'rgba(34,42,59,0)')
  shadowContext.fillStyle = shadowGradient
  shadowContext.fillRect(0, 0, 64, 64)
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas)
  const shadowMaterial = material(new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }))
  const shadow = mesh(new THREE.PlaneGeometry(4.8, 2.1), shadowMaterial, scene)
  shadow.position.set(0, -2.21, 0)
  shadow.rotation.x = -Math.PI / 2

  return {
    scene,
    camera,
    update(elapsed, pointer, reduced) {
      const time = reduced ? 0 : elapsed
      assembly.rotation.y = pointer.x * 0.12
      assembly.rotation.x = pointer.y * 0.065
      assembly.position.y = reduced ? 0 : Math.sin(time * 0.58) * 0.055
      silverOrbit.rotation.z = 0.38 + time * 0.075
      orbitBlue.rotation.z = -0.61 - time * 0.052
      crystals.position.y = reduced ? 0 : Math.sin(time * 0.58 + 0.6) * 0.055
    },
    resize(width, height) {
      camera.aspect = width / height
      camera.position.z = camera.aspect < 0.9 ? 10.4 : 9.2
      camera.updateProjectionMatrix()
    },
    dispose() {
      objects.forEach((item) => item.dispose())
      materials.forEach((item) => item.dispose())
      shadowTexture.dispose()
      environment.dispose()
      scene.clear()
    },
  }
}

export default function GallerySculpture({ image: _image, mode = 'daily', paused = false }) {
  const hostRef = useRef(null)
  const pausedRef = useRef(paused)
  const syncRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof window.WebGL2RenderingContext !== 'function') return undefined
    const pointerSurface = host.closest('.gx-stage') || host
    let cancelled = false
    let failed = false
    let visible = typeof IntersectionObserver !== 'function'
    let renderer = null
    let sculpture = null
    let frame = null
    let lastTime = null
    let elapsed = 0
    let width = 0
    let height = 0
    let needsDraw = true
    let presented = false
    let shaderFailed = false
    const target = { x: 0, y: 0 }
    const pointer = { x: 0, y: 0 }
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let reduced = Boolean(preference?.matches)

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      lastTime = null
    }
    const canDraw = () => !cancelled && !failed && visible && !document.hidden && sculpture && renderer && width > 0 && height > 0
    const draw = () => {
      sculpture.update(elapsed, reduced ? { x: 0, y: 0 } : pointer, reduced)
      renderer.render(sculpture.scene, sculpture.camera)
      if (shaderFailed) throw new Error('Gallery sculpture shader unavailable')
      needsDraw = false
      if (!presented) { presented = true; setReady(true) }
    }
    const release = () => {
      sculpture?.dispose()
      sculpture = null
      if (renderer) {
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
        renderer.dispose()
        renderer.forceContextLoss()
        renderer.domElement.remove()
        renderer = null
      }
    }
    const fail = () => {
      failed = true
      stop()
      release()
      if (!cancelled) setReady(false)
    }
    const tick = (time) => {
      frame = null
      if (!canDraw() || pausedRef.current || reduced) { lastTime = null; return }
      const delta = lastTime === null ? 0 : (time - lastTime) / 1000
      // Skip surplus high-refresh callbacks. Keep the previous draw timestamp
      // until rendering so elapsed time includes every skipped interval.
      if (lastTime !== null && delta < 1 / 60 - 0.00001) {
        frame = requestAnimationFrame(tick)
        return
      }
      lastTime = time
      elapsed += delta
      const smoothing = 1 - Math.exp(-Math.min(delta, 0.1) * 5)
      pointer.x += (target.x - pointer.x) * smoothing
      pointer.y += (target.y - pointer.y) * smoothing
      try { draw() } catch { fail(); return }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      if (!canDraw()) { stop(); return }
      if (pausedRef.current || reduced) {
        stop()
        if (needsDraw) {
          try { draw() } catch { fail() }
        }
      } else if (frame === null) frame = requestAnimationFrame(tick)
    }
    const resize = () => {
      if (!renderer || !sculpture) return
      const bounds = host.getBoundingClientRect()
      width = Math.round(bounds.width)
      height = Math.round(bounds.height)
      if (!width || !height) { stop(); return }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35))
      renderer.setSize(width, height, false)
      sculpture.resize(width, height)
      needsDraw = true
      sync()
    }
    const onPointer = (event) => {
      if (reduced || pausedRef.current) return
      const bounds = host.getBoundingClientRect()
      if (!bounds.width || !bounds.height) return
      target.x = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
      target.y = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
    }
    const onLeave = () => { target.x = 0; target.y = 0 }
    const onContextLost = (event) => { event.preventDefault(); fail() }
    const onPreference = () => { reduced = Boolean(preference?.matches); needsDraw = true; sync() }
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync() }, { threshold: 0 }) : null
    const resizer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    observer?.observe(host)
    resizer?.observe(host)
    if (!resizer) window.addEventListener('resize', resize, { passive: true })
    pointerSurface.addEventListener('pointermove', onPointer, { passive: true })
    pointerSurface.addEventListener('pointerleave', onLeave, { passive: true })
    document.addEventListener('visibilitychange', sync)
    preference?.addEventListener?.('change', onPreference)
    syncRef.current = () => { needsDraw = true; sync() }
    setReady(false)

    import('three').then((THREE) => {
      if (cancelled) return
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
        renderer.setClearColor(0x000000, 0)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.1
        if (renderer.debug) renderer.debug.onShaderError = () => { shaderFailed = true }
        renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
        renderer.domElement.setAttribute('aria-hidden', 'true')
        renderer.domElement.addEventListener('webglcontextlost', onContextLost)
        sculpture = makeSculpture(THREE, renderer, mode)
        host.appendChild(renderer.domElement)
        resize()
      } catch { fail() }
    }).catch(fail)

    return () => {
      cancelled = true
      stop()
      observer?.disconnect()
      resizer?.disconnect()
      window.removeEventListener('resize', resize)
      pointerSurface.removeEventListener('pointermove', onPointer)
      pointerSurface.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', sync)
      preference?.removeEventListener?.('change', onPreference)
      syncRef.current = null
      release()
    }
  }, [mode])

  useEffect(() => { pausedRef.current = paused; syncRef.current?.() }, [paused])

  return <div ref={hostRef} className="gallery-sculpture" aria-hidden="true" data-renderer={ready ? 'webgl' : 'fallback'} style={{ position: 'absolute', inset: 0, overflow: 'hidden', isolation: 'isolate' }}>
    <div style={{ position: 'absolute', inset: '11% 12% 12%', opacity: ready ? 0 : 1, pointerEvents: 'none', perspective: 800 }}>
      <div style={{ position: 'absolute', width: '65%', height: '65%', left: '17%', top: '10%', border: 'clamp(16px, 4vw, 32px) solid #2449ec', borderRadius: '50%', boxShadow: 'inset 5px 4px 8px #89acff, 7px 8px 0 #1738ae, 14px 14px 28px #193cb62e', transform: 'rotateY(-22deg) rotateX(12deg) rotateZ(-18deg)' }} />
      <div style={{ position: 'absolute', width: '91%', height: '83%', left: '3%', top: '2%', border: '8px solid #c6ceda', borderRadius: '50%', boxShadow: 'inset 2px 2px 1px #fff, 1px 2px 2px #5c6784', transform: 'rotateY(35deg) rotateX(35deg) rotateZ(32deg)' }} />
      <div style={{ position: 'absolute', width: '55%', height: '10%', left: '23%', bottom: 0, borderRadius: '50%', background: 'linear-gradient(15deg,#828a9d,#f5f7ff 48%,#bbc3cf 52%,#fafcff)', boxShadow: '0 7px 0 #9ca6b7, 0 17px 20px #1a28491c' }} />
    </div>
  </div>
}
