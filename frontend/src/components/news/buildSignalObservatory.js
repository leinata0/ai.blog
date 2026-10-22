const TAU = Math.PI * 2
const smooth = (min, max, value) => {
  const t = Math.min(1, Math.max(0, (value - min) / (max - min)))
  return t * t * (3 - 2 * t)
}

export default function buildSignalObservatory(THREE, renderer) {
  const scene = new THREE.Scene()
  const resources = new Set()
  const own = (resource) => { resources.add(resource); return resource }
  const dispose = () => {
    scene.environment = null
    resources.forEach((resource) => resource.dispose())
    resources.clear()
    scene.clear()
  }
  try {
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 150)
    const observatory = new THREE.Group()
    observatory.name = 'signal-observatory'
    scene.add(observatory)
    const silver = own(new THREE.MeshStandardMaterial({ color: '#d5e3f1', metalness: 0.78, roughness: 0.27, envMapIntensity: 1.35 }))
    const darkMetal = own(new THREE.MeshStandardMaterial({ color: '#263e59', metalness: 0.82, roughness: 0.32, envMapIntensity: 1.2 }))
    const blueMetal = own(new THREE.MeshStandardMaterial({ color: '#175cb4', metalness: 0.7, roughness: 0.24, envMapIntensity: 1.3 }))
    const blueLight = own(new THREE.MeshStandardMaterial({ color: '#91dfff', emissive: '#118aff', emissiveIntensity: 4, metalness: 0.15, roughness: 0.3 }))
    const orangeLight = own(new THREE.MeshBasicMaterial({ color: '#ffad63', toneMapped: false }))
    const mesh = (geometry, material, parent = observatory) => {
      const object = new THREE.Mesh(own(geometry), material)
      parent.add(object)
      return object
    }
    const cylinderBetween = (start, end, radius, material, parent) => {
      const a = new THREE.Vector3(...start)
      const b = new THREE.Vector3(...end)
      const body = mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 10), material, parent)
      body.position.copy(a).add(b).multiplyScalar(0.5)
      body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize())
      return body
    }

    // The receiver has a complete chassis, elevation joint and load bearing arms.
    const foot = mesh(new THREE.CylinderGeometry(0.85, 1, 0.18, 48), darkMetal)
    foot.position.set(0, -2.55, -0.48)
    const footTrim = mesh(new THREE.TorusGeometry(0.85, 0.025, 6, 64), silver)
    footTrim.rotation.x = Math.PI / 2
    footTrim.position.copy(foot.position).y += 0.1
    const stem = mesh(new THREE.CylinderGeometry(0.29, 0.4, 1.15, 16), silver)
    stem.position.set(0, -1.92, -0.48)
    for (let index = 0; index < 4; index += 1) {
      const collar = mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 32), darkMetal)
      collar.rotation.x = Math.PI / 2
      collar.position.set(0, -2.3 + index * 0.22, -0.48)
    }
    for (const side of [-1, 1]) {
      cylinderBetween([side * 0.23, -1.6, -0.48], [side * 0.62, -0.45, -0.38], 0.075, silver)
      const joint = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 32), darkMetal)
      joint.rotation.z = Math.PI / 2
      joint.position.set(side * 0.64, -0.45, -0.38)
      const cap = mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.18, 32), silver)
      cap.rotation.z = Math.PI / 2
      cap.position.copy(joint.position)
    }
    const status = mesh(new THREE.BoxGeometry(0.2, 0.045, 0.035), orangeLight)
    status.position.set(0, -1.73, -0.16)

    const dish = new THREE.Group()
    dish.name = 'parabolic-dish'
    dish.position.set(0, 0.36, 0)
    dish.rotation.set(0.22, -0.82, 0.08)
    observatory.add(dish)
    const radius = 2.2
    const focalLength = 1.25
    const depth = (r) => (r * r) / (4 * focalLength)

    // Repeated punched metal, not a flat line icon. The concave surface receives
    // real lighting while each opening reveals the ribs behind it.
    const punchData = new Uint8Array(32 * 32 * 4)
    for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
      const value = Math.hypot(x - 15.5, y - 15.5) < 10 ? 0 : 255
      const offset = (y * 32 + x) * 4
      punchData.set([value, value, value, 255], offset)
    }
    const punch = own(new THREE.DataTexture(punchData, 32, 32, THREE.RGBAFormat))
    punch.wrapS = punch.wrapT = THREE.RepeatWrapping
    punch.repeat.set(64, 64)
    punch.needsUpdate = true
    const dishMetal = own(new THREE.MeshStandardMaterial({ color: '#e2ebf6', metalness: 0.74, roughness: 0.34, side: THREE.DoubleSide, alphaMap: punch, alphaTest: 0.5, envMapIntensity: 1.25 }))

    const positions = [], uvs = [], indices = []
    const rows = 24, columns = 22
    for (let row = 0; row <= rows; row += 1) {
      const r = 0.18 + (radius - 0.18) * row / rows
      for (let col = 0; col <= columns; col += 1) {
        const angle = -Math.PI / 6 + (Math.PI / 3) * col / columns
        const x = Math.cos(angle) * r, y = Math.sin(angle) * r
        positions.push(x, y, depth(r))
        uvs.push(x / (radius * 2) + 0.5, y / (radius * 2) + 0.5)
        if (row < rows && col < columns) {
          const a = row * (columns + 1) + col, b = a + columns + 1
          indices.push(a, b, b + 1, a, b + 1, a + 1)
        }
      }
    }
    const petalGeometry = own(new THREE.BufferGeometry())
    petalGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    petalGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    petalGeometry.setIndex(indices)
    petalGeometry.computeVertexNormals()
    const rimCurve = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => {
      const angle = -Math.PI / 6 + Math.PI / 3 * i / 24
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, depth(radius))
    }))
    const rimGeometry = own(new THREE.TubeGeometry(rimCurve, 24, 0.055, 8, false))
    const ribCurve = new THREE.CatmullRomCurve3(Array.from({ length: 15 }, (_, i) => {
      const r = 0.2 + (radius - 0.2) * i / 14
      return new THREE.Vector3(r, 0, depth(r) - 0.09)
    }))
    const ribGeometry = own(new THREE.TubeGeometry(ribCurve, 18, 0.052, 8, false))
    const petals = []
    for (let index = 0; index < 6; index += 1) {
      const sector = new THREE.Group()
      sector.rotation.z = index * TAU / 6
      const leaf = new THREE.Group()
      sector.add(leaf)
      const surface = new THREE.Mesh(petalGeometry, dishMetal)
      surface.name = 'perforated-reflector-panel'
      leaf.add(surface, new THREE.Mesh(rimGeometry, silver), new THREE.Mesh(ribGeometry, darkMetal))
      dish.add(sector)
      petals.push(leaf)
    }
    const backHub = mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.48, 24), darkMetal, dish)
    backHub.rotation.x = Math.PI / 2
    backHub.position.z = -0.22
    const hubCap = mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 32), silver, dish)
    hubCap.rotation.x = Math.PI / 2
    hubCap.position.z = 0.03
    const supports = new THREE.Group()
    supports.name = 'three-feed-supports'
    dish.add(supports)
    for (let index = 0; index < 3; index += 1) {
      const angle = index * TAU / 3 + Math.PI / 6
      cylinderBetween([Math.cos(angle) * 2.08, Math.sin(angle) * 2.08, depth(2.08)], [0, 0, 1.65], 0.028, silver, supports)
    }
    const feed = new THREE.Group()
    feed.name = 'blue-signal-receiver'
    feed.position.z = 1.65
    dish.add(feed)
    const feedBody = mesh(new THREE.CylinderGeometry(0.17, 0.26, 0.52, 24), blueMetal, feed)
    feedBody.rotation.x = Math.PI / 2
    const feedLens = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.055, 24), blueLight, feed)
    feedLens.rotation.x = Math.PI / 2
    feedLens.position.z = 0.28
    const feedRing = mesh(new THREE.TorusGeometry(0.2, 0.018, 8, 40), silver, feed)
    feedRing.position.z = 0.18
    const glowData = new Uint8Array(64 * 64 * 4)
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const alpha = Math.pow(Math.max(0, 1 - Math.hypot(x - 31.5, y - 31.5) / 31.5), 3)
      glowData.set([255, 255, 255, Math.round(alpha * 255)], (y * 64 + x) * 4)
    }
    const glowTexture = own(new THREE.DataTexture(glowData, 64, 64, THREE.RGBAFormat))
    glowTexture.needsUpdate = true
    const glowMaterial = own(new THREE.SpriteMaterial({ map: glowTexture, color: '#3b9aff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    const glow = new THREE.Sprite(glowMaterial)
    glow.position.z = 0.35
    glow.scale.set(1.1, 1.1, 1)
    feed.add(glow)

    const arcs = new THREE.Group()
    dish.add(arcs)
    const arcMaterial = own(new THREE.LineBasicMaterial({ color: '#438cff', transparent: true, opacity: 0.19, blending: THREE.AdditiveBlending, depthWrite: false }))
    const pulseMaterial = own(new THREE.MeshBasicMaterial({ color: '#85d9ff', toneMapped: false }))
    const pulseGeometry = own(new THREE.SphereGeometry(0.035, 6, 6))
    const pulses = []
    for (let index = 0; index < 3; index += 1) {
      const angle = index * TAU / 3 + 0.4
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle) * 7, Math.sin(angle) * 5, -3),
        new THREE.Vector3(Math.cos(angle) * 4, Math.sin(angle) * 3, 2),
        new THREE.Vector3(Math.cos(angle) * 1.8, Math.sin(angle) * 1.3, 3),
        new THREE.Vector3(0, 0, 1.95),
      ])
      const line = new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64))), arcMaterial)
      const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial)
      arcs.add(line, pulse)
      pulses.push({ curve, pulse, phase: index / 3 })
    }

    // Seeded, three depth layers. Each star keeps its identity while the camera
    // enters the beam and its position resolves into a flat signal array.
    let seed = 918271
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const stars = []
    const starVertex = `attribute float aSize; attribute float aPhase; attribute vec3 aColor;
      uniform float uTime; uniform float uDpr; uniform float uBeam; varying vec3 vColor; varying float vTwinkle;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(aSize*(24.0+uBeam*30.0)/max(1.0,-mv.z),0.7,11.0)*uDpr;
      vColor=aColor; vTwinkle=0.72+0.28*sin(aPhase+uTime*0.45); }`
    const starFragment = `uniform float uOpacity; varying vec3 vColor; varying float vTwinkle;
      void main(){ float d=length(gl_PointCoord-vec2(0.5));
      float alpha=(1.0-smoothstep(0.03,0.5,d))*vTwinkle*uOpacity;
      gl_FragColor=vec4(vColor*(0.8+0.7*(1.0-smoothstep(0.0,0.18,d))),alpha); }`
    for (let layer = 0; layer < 3; layer += 1) {
      const count = 680
      const initial = new Float32Array(count * 3), tunnel = new Float32Array(count * 3), array = new Float32Array(count * 3)
      const colors = [], sizes = [], phases = []
      for (let index = 0; index < count; index += 1) {
        const angle = random() * TAU
        const r = layer === 0 ? 3.1 + random() * 0.8 : 5 + layer * 4 + random() * 6
        initial.set([(random() - 0.5) * 54, (random() - 0.5) * 32, -8 - random() * 76], index * 3)
        tunnel.set([Math.cos(angle) * r, Math.sin(angle) * r, 6 - random() * 86], index * 3)
        const cell = layer * count + index
        array.set([((cell % 54) - 26.5) * 0.37, (Math.floor(cell / 54) - 18.5) * 0.31, -53], index * 3)
        const warm = random() > 0.96
        colors.push(...(warm ? [1, 0.62, 0.32] : [0.35 + random() * 0.35, 0.65 + random() * 0.25, 1]))
        sizes.push(0.65 + random() * (1.2 + layer * 0.35))
        phases.push(random() * TAU)
      }
      const geometry = own(new THREE.BufferGeometry())
      geometry.setAttribute('position', new THREE.BufferAttribute(initial.slice(), 3).setUsage(THREE.DynamicDrawUsage))
      geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1))
      geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1))
      geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3))
      const material = own(new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, uniforms: { uTime: { value: 0 }, uDpr: { value: 1 }, uBeam: { value: 0 }, uOpacity: { value: 0.7 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
      const points = new THREE.Points(geometry, material)
      points.frustumCulled = false
      points.name = `signal-stars-${layer}`
      scene.add(points)
      stars.push({ geometry, material, initial, tunnel, array })
    }
    // Sparse light paths give the flight a vanishing point. The dense near star
    // layer moves along these paths; the device remains the only solid subject.
    const beamMaterial = own(new THREE.LineBasicMaterial({ color: '#3e8eff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    for (let strand = 0; strand < 5; strand += 1) {
      const path = Array.from({ length: 100 }, (_, index) => {
        const t = index / 99
        const angle = strand * TAU / 5 + t * 2.2
        const r = 3.35 + Math.sin(t * Math.PI) * 0.28
        return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 8 - t * 90)
      })
      scene.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(path)), beamMaterial))
    }
    const gridPositions = []
    for (let x = -9; x <= 9; x += 1) gridPositions.push(x, -5.8, -53.1, x, 5.8, -53.1)
    for (let y = -5; y <= 5; y += 1) gridPositions.push(-10, y, -53.1, 10, y, -53.1)
    const gridMaterial = own(new THREE.LineBasicMaterial({ color: '#348fff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
    const gridGeometry = own(new THREE.BufferGeometry())
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3))
    const signalGrid = new THREE.LineSegments(gridGeometry, gridMaterial)
    signalGrid.name = 'signal-array'
    scene.add(signalGrid)

    scene.add(new THREE.HemisphereLight('#d9eeff', '#10273e', 1.8))
    const key = new THREE.DirectionalLight('#eef6ff', 4.2)
    key.position.set(-5, 5, 7)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#3998ff', 5)
    rim.position.set(4, 2, -4)
    scene.add(rim)
    const warmFill = new THREE.DirectionalLight('#ffbe83', 1)
    warmFill.position.set(-4, -2, 3)
    scene.add(warmFill)
    const studio = new THREE.Scene()
    studio.background = new THREE.Color('#152b48')
    const panelGeometry = new THREE.PlaneGeometry(1, 1)
    const panelMaterials = []
    let pmrem
    try {
      for (const [color, intensity, position, scale] of [
        ['#e1efff', 4, [-4, 4, 4], [4, 6]], ['#488fff', 3, [5, 1, -2], [3, 6]], ['#ffe7ce', 2, [-2, -3, 4], [3, 2]],
      ]) {
        const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide })
        panelMaterials.push(material)
        const panel = new THREE.Mesh(panelGeometry, material)
        panel.position.set(...position)
        panel.scale.set(...scale, 1)
        panel.lookAt(0, 0, 0)
        studio.add(panel)
      }
      pmrem = new THREE.PMREMGenerator(renderer)
      const environment = own(pmrem.fromScene(studio, 0.04, 0.1, 30, { size: 128 }))
      scene.environment = environment.texture
    } finally {
      pmrem?.dispose()
      panelGeometry.dispose()
      panelMaterials.forEach((material) => material.dispose())
      studio.clear()
    }

    let initialized = false
    let aspect = 1
    const lookTarget = new THREE.Vector3()
    const destination = new THREE.Vector3()
    const dampVector = (current, target, delta, snap) => {
      if (snap) current.copy(target)
      else current.lerp(target, 1 - Math.exp(-12 * delta))
    }
    return {
      scene, camera, dispose,
      resize(width, height, dpr) {
        aspect = width / height
        initialized = false
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        stars.forEach(({ material }) => { material.uniforms.uDpr.value = dpr })
      },
      update({ elapsed, delta, progress, pointerX, pointerY, reduced }) {
        const time = reduced ? 0 : elapsed
        const snap = !initialized || reduced
        const departure = smooth(0.25, 0.62, progress)
        const flight = smooth(0.28, 0.84, progress)
        const resolve = smooth(0.72, 0.97, progress)
        const portrait = Math.max(0, 1 - aspect)
        const compact = smooth(0.1, 0.4, portrait)
        const initialX = 2.25 - compact * 0.65
        const initialZ = 11 + portrait * 5
        // Portrait framing leaves the heading and all four chapter links above
        // the reflector; its lower chassis may extend below the first viewport.
        destination.set(initialX - departure * 11, -0.1 - compact * 3.2 + departure * 6 + Math.sin(time * 0.62) * 0.055, -departure * 18)
        dampVector(observatory.position, destination, delta, snap)
        const yaw = Math.sin(time * 0.28) * 0.055 + pointerX * 0.065 + departure * 0.9
        observatory.rotation.y = snap ? yaw : THREE.MathUtils.damp(observatory.rotation.y, yaw, 10, delta)
        observatory.rotation.z = -0.025 + Math.sin(time * 0.36 + 0.6) * 0.012 - departure * 0.28
        observatory.scale.setScalar((1 - compact * 0.32) * (1 - departure * 0.55))
        observatory.visible = progress < 0.67
        dish.rotation.x = 0.22 + pointerY * 0.035 + Math.sin(time * 0.45) * 0.02 + smooth(0, 0.28, progress) * 0.14
        petals.forEach((leaf, index) => { leaf.rotation.y = -smooth(0.04, 0.26, progress) * (0.025 + Math.sin(index * 0.8 + time * 0.15) * 0.006) })
        glow.scale.setScalar(1.05 + Math.sin(time * 1.3 - 0.4) * 0.08)
        glowMaterial.opacity = 0.8 + Math.sin(time * 1.3) * 0.12
        pulses.forEach(({ curve, pulse, phase }) => { curve.getPointAt((time * 0.13 + phase) % 1, pulse.position) })
        arcs.visible = progress < 0.45

        destination.set(Math.sin(flight * Math.PI) * 1.4 + pointerX * 0.14 * (1 - flight), 0.4 + Math.sin(flight * Math.PI) * 0.5 - pointerY * 0.12, initialZ + (-29 - initialZ) * flight)
        dampVector(camera.position, destination, delta, snap)
        destination.set(-flight * 0.3, 0.05, -flight * 53)
        dampVector(lookTarget, destination, delta, snap)
        camera.lookAt(lookTarget)

        const enterBeam = smooth(0.2, 0.65, progress)
        const fade = 1 - smooth(0.94, 1, progress) * 0.7
        stars.forEach(({ geometry, material, initial, tunnel, array }, layer) => {
          const attribute = geometry.getAttribute('position')
          for (let index = 0; index < attribute.array.length; index += 3) {
            const drift = Math.sin(time * 0.065 + index * 0.13 + layer) * 0.055 * (1 - resolve)
            for (let axis = 0; axis < 3; axis += 1) {
              const offset = index + axis
              const flowing = axis === 2 ? -80 + ((tunnel[offset] + 80 + time * (layer === 0 ? 3.2 : 1.5)) % 86) : tunnel[offset]
              const beam = initial[offset] + (flowing - initial[offset]) * enterBeam
              attribute.array[offset] = beam + (array[offset] - beam) * resolve + (axis === 0 ? drift : 0)
            }
          }
          attribute.needsUpdate = true
          material.uniforms.uTime.value = time
          material.uniforms.uBeam.value = enterBeam
          material.uniforms.uOpacity.value = (0.5 + layer * 0.1 + enterBeam * 0.45) * fade
        })
        beamMaterial.opacity = enterBeam * (1 - resolve) * 0.2
        gridMaterial.opacity = resolve * 0.17 * fade
        initialized = true
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
