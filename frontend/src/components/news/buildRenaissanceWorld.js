import { optimizedImageUrl } from '../../utils/responsiveImage'

export const RENAISSANCE_ASSETS = {
  world: '/images/renaissance-edition/world.jpg',
  figures: '/images/renaissance-edition/figures.png',
}

const smooth = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

// Keep the original UV grid: these triangles are wholly inside the cloud
// shader's zero-alpha mask, even while the sampled texture drifts horizontally.
export function createCloudGeometry(THREE) {
  const geometry = new THREE.PlaneGeometry(1, 1, 64, 36)
  const uv = geometry.getAttribute('uv')
  const original = geometry.getIndex()
  const indices = []
  for (let index = 0; index < original.count; index += 3) {
    const a = original.getX(index), b = original.getX(index + 1), c = original.getX(index + 2)
    const maxV = Math.max(uv.getY(a), uv.getY(b), uv.getY(c))
    const minU = Math.min(uv.getX(a), uv.getX(b), uv.getX(c))
    const maxU = Math.max(uv.getX(a), uv.getX(b), uv.getX(c))
    if (maxV > 0.46 && (minU < 0.38 || maxU > 0.62)) indices.push(a, b, c)
  }
  geometry.setIndex(indices)
  return geometry
}

// Upper bound of the fragment alpha (grain and texture alpha cannot exceed 1).
// Hide a draw only once every fragment would hit the shader's discard anyway.
export function maximumPlaneAlpha(dissolve, sourceAlpha = 1) {
  if (dissolve <= 0.001) return sourceAlpha
  return sourceAlpha * smooth(dissolve - 0.045, dissolve + 0.045, 1) * (1 - smooth(0.5, 1.08, dissolve))
}

export function sampleRibbonSurface(u, v, time = 0) {
  const width = 0.48 * (1 + 0.07 * Math.sin(u * 2 - time * 0.42))
  const widthU = 0.0672 * Math.cos(u * 2 - time * 0.42)
  const twist = u * 0.5 + 0.11 * Math.sin(u - time * 0.28)
  const twistU = 0.5 + 0.11 * Math.cos(u - time * 0.28)
  const cosU = Math.cos(u), sinU = Math.sin(u), cosV = Math.cos(v), sinV = Math.sin(v)
  const cosTwist = Math.cos(twist), sinTwist = Math.sin(twist)
  const a = width * cosV, b = 0.085 * sinV, aU = widthU * cosV
  const aV = -width * sinV, bV = 0.085 * cosV
  const r = 1.42 + 0.035 * Math.sin(u * 3 - time * 0.5) + a * cosTwist - b * sinTwist
  const rU = 0.105 * Math.cos(u * 3 - time * 0.5) + aU * cosTwist - twistU * (a * sinTwist + b * cosTwist)
  const rV = aV * cosTwist - bV * sinTwist
  return {
    position: [r * cosU, r * sinU, a * sinTwist + b * cosTwist + 0.12 * Math.sin(u * 2 + time * 0.15)],
    du: [rU * cosU - r * sinU, rU * sinU + r * cosU, aU * sinTwist + twistU * (a * cosTwist - b * sinTwist) + 0.24 * Math.cos(u * 2 + time * 0.15)],
    dv: [rV * cosU, rV * sinU, aV * sinTwist + bV * cosTwist],
  }
}

const planeVertex = `uniform float uTime; uniform float uFigure; varying vec2 vUv;
  void main(){ vUv=uv; vec3 p=position;
    float cloth=(1.0-smoothstep(0.42,0.65,uv.y))*smoothstep(0.12,0.43,abs(uv.x-0.5));
    p.x+=uFigure*cloth*sin(uTime*0.75+uv.y*9.0)*0.025;
    p.z+=uFigure*cloth*cos(uTime*0.55+uv.x*8.0)*0.035;
    p.z+=(1.0-uFigure)*smoothstep(0.5,0.95,uv.y)*sin(uv.x*7.0+uTime*0.16)*0.04;
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`

const planeFragment = `uniform sampler2D uMap; uniform float uFigure; uniform float uHalf;
  uniform float uTime; uniform float uDissolve; uniform float uCloud; varying vec2 vUv;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  void main(){
    vec2 uv=vUv;
    uv.x=uFigure>0.5 ? uHalf+clamp(uv.x,0.001,0.999)*0.5 : uv.x;
    if(uCloud>0.0) uv.x+=sin(uTime*0.09+uCloud)*0.012;
    vec4 color=texture2D(uMap,uv);
    if(uCloud>0.0){
      float sky=smoothstep(0.46,0.73,vUv.y)*smoothstep(0.12,0.4,abs(vUv.x-0.5));
      color.a*=sky*smoothstep(0.65,0.92,max(color.r,max(color.g,color.b)))*0.17;
    }
    // Only translucent, nearly pure red extraction fringes are suppressed.
    if(uFigure>0.5 && color.a<0.85){
      float fringe=smoothstep(0.55,0.9,color.r)*(1.0-smoothstep(0.08,0.22,max(color.g,color.b)));
      color.a*=1.0-fringe*0.9;
    }
    if(uDissolve>0.001){
      float grain=hash(floor(vUv*vec2(640.0,420.0)));
      color.a*=smoothstep(uDissolve-0.045,uDissolve+0.045,grain);
      color.a*=1.0-smoothstep(0.5,1.08,uDissolve);
    }
    if(color.a<0.012) discard;
    gl_FragColor=color;
    #include <colorspace_fragment>
  }`

export function createRibbonGeometry(THREE) {
  const rows = 192, columns = 24
  const positions = [], normals = [], parameters = [], indices = []
  const normal = new THREE.Vector3(), tangent = new THREE.Vector3()
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < columns; col += 1) {
    const u = row / rows * Math.PI * 2, v = col / columns * Math.PI * 2
    const sample = sampleRibbonSurface(u, v)
    positions.push(...sample.position)
    normal.fromArray(sample.du).cross(tangent.fromArray(sample.dv)).normalize()
    normals.push(normal.x, normal.y, normal.z)
    parameters.push(u, v)
    const nextRow = (row + 1) % rows
    const shift = row === rows - 1 ? columns / 2 : 0
    const a0 = row * columns + col, a1 = row * columns + (col + 1) % columns
    const b0 = nextRow * columns + (col + shift) % columns
    const b1 = nextRow * columns + (col + 1 + shift) % columns
    indices.push(a0, b0, a1, a1, b0, b1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aRibbon', new THREE.Float32BufferAttribute(parameters, 2))
  geometry.setIndex(indices)
  // Enclose the animated surface too; the GPU deforms beyond its t=0 bounds.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.1)
  return geometry
}

const ribbonSurface = `uniform float uRibbonTime; attribute vec2 aRibbon; varying vec2 vRibbonUV;
  void liquidRibbon(float u,float v,out vec3 p,out vec3 du,out vec3 dv){
    float t=uRibbonTime;
    float width=0.48*(1.0+0.07*sin(u*2.0-t*0.42));
    float widthU=0.0672*cos(u*2.0-t*0.42);
    float twist=u*0.5+0.11*sin(u-t*0.28);
    float twistU=0.5+0.11*cos(u-t*0.28);
    float cu=cos(u),su=sin(u),cv=cos(v),sv=sin(v),ct=cos(twist),st=sin(twist);
    float a=width*cv,b=0.085*sv,aU=widthU*cv,aV=-width*sv,bV=0.085*cv;
    float r=1.42+0.035*sin(u*3.0-t*0.5)+a*ct-b*st;
    float rU=0.105*cos(u*3.0-t*0.5)+aU*ct-twistU*(a*st+b*ct);
    float rV=aV*ct-bV*st;
    p=vec3(r*cu,r*su,a*st+b*ct+0.12*sin(u*2.0+t*0.15));
    du=vec3(rU*cu-r*su,rU*su+r*cu,aU*st+twistU*(a*ct-b*st)+0.24*cos(u*2.0+t*0.15));
    dv=vec3(rV*cu,rV*su,aV*st+bV*ct);
  }`

export default function buildRenaissanceWorld(THREE, renderer) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80)
  const resources = new Set()
  const own = (resource) => { resources.add(resource); return resource }
  let disposed = false
  let loaded = false
  let aspect = 1
  const look = new THREE.Vector3()
  const frustum = new THREE.Frustum()
  const projectionView = new THREE.Matrix4()
  // Include the vertex shader's maximum cloth displacement before world scale.
  const figureBounds = new THREE.Box3(new THREE.Vector3(-0.53, -0.5, -0.04), new THREE.Vector3(0.53, 0.5, 0.04))
  const worldBounds = new THREE.Box3()
  const planes = []
  const dispose = () => {
    if (disposed) return
    disposed = true
    scene.environment = null
    resources.forEach((resource) => resource.dispose())
    resources.clear()
    scene.clear()
  }
  const loadTexture = (url, original = url) => new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader()
    let texture
    texture = loader.load(url, () => {
      if (disposed) { texture.dispose(); resolve(null); return }
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = Math.min(4, renderer.capabilities?.getMaxAnisotropy?.() || 1)
      resolve(texture)
    }, undefined, (error) => {
      if (!disposed && url !== original) loadTexture(original).then(resolve, reject)
      else reject(error)
    })
    own(texture)
  })
  try {
    const makePlane = (name, figure = false, half = 0, cloud = 0) => {
      const uniforms = { uMap: { value: null }, uFigure: { value: figure ? 1 : 0 }, uHalf: { value: half }, uTime: { value: 0 }, uDissolve: { value: 0 }, uCloud: { value: cloud } }
      const material = own(new THREE.ShaderMaterial({ vertexShader: planeVertex, fragmentShader: planeFragment, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
      // These alpha-composited sheets deliberately need only one transparent pass.
      material.forceSinglePass = true
      const geometry = own(cloud ? createCloudGeometry(THREE) : new THREE.PlaneGeometry(1, 1, figure ? 28 : 64, figure ? 40 : 36))
      const plane = new THREE.Mesh(geometry, material)
      plane.name = name
      plane.renderOrder = figure ? 10 + half : cloud ? -5 + cloud : -10
      scene.add(plane)
      planes.push(plane)
      return plane
    }
    const world = makePlane('renaissance-garden')
    world.position.z = -12
    const clouds = [makePlane('renaissance-far-clouds', false, 0, 1), makePlane('renaissance-near-clouds', false, 0, 2)]
    clouds[0].position.z = -8
    clouds[1].position.z = -5
    const left = makePlane('renaissance-woman', true, 0)
    const right = makePlane('renaissance-man', true, 0.5)
    const figures = [left, right]
    const ribbonTime = { value: 0 }
    const chrome = own(new THREE.MeshPhysicalMaterial({ color: '#d6ff55', metalness: 1, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.1, envMapIntensity: 1.3, transparent: true, depthWrite: false }))
    chrome.onBeforeCompile = (shader) => {
      shader.uniforms.uRibbonTime = ribbonTime
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${ribbonSurface}`)
        .replace('#include <beginnormal_vertex>', `vec3 ribbonPosition,ribbonDU,ribbonDV;
          liquidRibbon(aRibbon.x,aRibbon.y,ribbonPosition,ribbonDU,ribbonDV);
          vec3 objectNormal=normalize(cross(ribbonDU,ribbonDV));`)
        .replace('#include <begin_vertex>', 'vRibbonUV=aRibbon; vec3 transformed=ribbonPosition;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRibbonUV;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb=mix(vec3(0.82,0.88,0.94),vec3(0.67,1.0,0.09),smoothstep(-0.3,0.3,sin(vRibbonUV.y+0.2)));')
    }
    chrome.customProgramCacheKey = () => 'renaissance-liquid-ribbon-v2'
    const ribbon = new THREE.Mesh(own(createRibbonGeometry(THREE)), chrome)
    ribbon.name = 'renaissance-liquid-chrome'
    ribbon.renderOrder = 20
    scene.add(ribbon)
    scene.add(new THREE.HemisphereLight('#e9edff', '#5a543b', 0.8))
    const key = new THREE.DirectionalLight('#fff0d3', 2.4)
    key.position.set(-5, 6, 5)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#b9d4f9', 1.6)
    rim.position.set(5, 1, -3)
    scene.add(rim)
    const rose = new THREE.DirectionalLight('#ff4797', 0.9)
    rose.position.set(4, -2, 4)
    scene.add(rose)

    let pairAspect = 1672 / 941
    let worldAspect = 1672 / 941
    const setSizes = () => {
      const viewHeight = 2 * 10.5 * Math.tan(38 * Math.PI / 360)
      const compact = Math.max(0, Math.min(1, (1.15 - aspect) / 0.65))
      const figureHeight = viewHeight * (1.04 - compact * 0.11)
      left.scale.set(figureHeight * pairAspect * 0.5, figureHeight, 1)
      right.scale.copy(left.scale)
      world.scale.set(Math.max(18 * worldAspect, 18 * aspect * 1.1), 18, 1)
      clouds.forEach((cloud) => {
        const height = 2 * (10.5 - cloud.position.z) * Math.tan(38 * Math.PI / 360) * 1.22
        cloud.scale.set(height * Math.max(worldAspect, aspect * 1.1), height, 1)
      })
    }
    const ready = Promise.all([loadTexture(optimizedImageUrl(RENAISSANCE_ASSETS.world), RENAISSANCE_ASSETS.world), loadTexture(optimizedImageUrl(RENAISSANCE_ASSETS.figures), RENAISSANCE_ASSETS.figures)]).then(([worldTexture, pairTexture]) => {
      if (disposed || !worldTexture || !pairTexture) return false
      worldAspect = worldTexture.image.width / worldTexture.image.height
      pairAspect = pairTexture.image.width / pairTexture.image.height
      world.material.uniforms.uMap.value = worldTexture
      clouds.forEach((cloud) => { cloud.material.uniforms.uMap.value = worldTexture })
      left.material.uniforms.uMap.value = pairTexture
      right.material.uniforms.uMap.value = pairTexture
      // The art itself supplies the chrome's colour and horizon reflections.
      const studio = new THREE.Scene()
      const sphereGeometry = new THREE.SphereGeometry(15, 24, 12)
      const sphereMaterial = new THREE.MeshBasicMaterial({ map: worldTexture, side: THREE.BackSide })
      studio.add(new THREE.Mesh(sphereGeometry, sphereMaterial))
      let pmrem
      try {
        pmrem = new THREE.PMREMGenerator(renderer)
        const environment = own(pmrem.fromScene(studio, 0.03, 0.1, 40, { size: 128 }))
        scene.environment = environment.texture
      } finally {
        pmrem?.dispose()
        sphereGeometry.dispose()
        sphereMaterial.dispose()
        studio.clear()
      }
      loaded = true
      setSizes()
      return true
    })

    return {
      scene, camera, ready, dispose,
      get hasVisibleContent() { return loaded && !disposed && (ribbon.visible || planes.some((plane) => plane.visible)) },
      resize(width, height) {
        aspect = width / height
        camera.aspect = aspect
        camera.updateProjectionMatrix()
        setSizes()
      },
      update({ elapsed, progress, pointerX, pointerY, reduced }) {
        if (!loaded || disposed) return
        const time = reduced ? 0 : elapsed
        const peel = smooth(0.22, 0.65, progress)
        const dissolve = smooth(0.65, 1, progress)
        const compact = Math.max(0, Math.min(1, (1.15 - aspect) / 0.65))
        const viewHeight = 2 * 10.5 * Math.tan(38 * Math.PI / 360)
        const halfWidth = viewHeight * aspect * 0.5
        const gap = halfWidth * 0.63
        // The scene hook already smooths progress and pointer values once.
        camera.position.set(Math.sin(peel * Math.PI) * 0.48 + pointerX * 0.28, 0.1 + pointerY * 0.24, 10.5 - peel * 2.1 - dissolve * 3.5)
        look.set(-peel * 0.08 + pointerX * 0.22, -peel * 0.12 + pointerY * 0.18, -peel * 1.2)
        camera.lookAt(look)
        left.position.set(-gap - halfWidth * (0.14 + compact * 0.24) - peel * 3.3 - pointerX * 0.14, 0.02 + compact * 0.12 + Math.sin(time * 0.55) * 0.025 + peel * 0.55 - pointerY * 0.08, 0.12 + peel * 1.6)
        right.position.set(gap + halfWidth * (0.14 + compact * 0.35) + peel * 3.8 - pointerX * 0.09, -0.02 - compact * 0.2 + Math.sin(time * 0.49 + 1.3) * 0.025 - peel * 0.3 - pointerY * 0.05, -0.15 - peel * 0.8)
        left.rotation.set(0, -peel * 0.06, -peel * 0.045)
        right.rotation.set(0, peel * 0.04, peel * 0.035)
        ribbon.position.set((1.7 - compact * 0.65) * (1 - peel) - pointerX * 0.08, -2.05 + peel * 1.85 - pointerY * 0.04, 1.15 + peel * 2.6)
        ribbon.rotation.set(0.75 + peel * 2.6 + Math.sin(time * 0.22) * 0.06, -0.45 + peel * 0.85 + time * 0.1 + pointerX * 0.06, -0.55 - peel * 0.8 + Math.sin(time * 0.28) * 0.1)
        ribbon.scale.setScalar((0.74 - compact * 0.12) * (1 + peel * 0.18))
        ribbonTime.value = time
        chrome.opacity = 1 - dissolve
        ribbon.visible = dissolve < 0.995
        planes.forEach((plane) => {
          plane.material.uniforms.uTime.value = time
          plane.material.uniforms.uDissolve.value = dissolve * 1.08
          plane.visible = maximumPlaneAlpha(dissolve * 1.08, plane.material.uniforms.uCloud.value ? 0.17 : 1) >= 0.012
        })
        clouds[0].position.x = Math.sin(time * 0.12) * 0.12 - peel * 0.15
        clouds[1].position.x = Math.sin(time * 0.09 + 1.5) * 0.2 + peel * 0.3
        camera.updateMatrixWorld(true)
        frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
        for (const figure of figures) {
          if (!figure.visible) continue
          figure.updateMatrixWorld(true)
          worldBounds.copy(figureBounds).applyMatrix4(figure.matrixWorld)
          figure.visible = frustum.intersectsBox(worldBounds)
        }
      },
    }
  } catch (error) {
    dispose()
    throw error
  }
}
