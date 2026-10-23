import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import buildRenaissanceWorld, { createCloudGeometry, createRibbonGeometry, maximumPlaneAlpha, sampleRibbonSurface } from '../src/components/news/buildRenaissanceWorld'

const resources = []
afterEach(() => { resources.splice(0).forEach((resource) => resource.dispose()) })
const keep = (resource) => { resources.push(resource); return resource }
const smooth = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

async function makeWorld(width = 1440, height = 900) {
  const generateEnvironment = vi.fn(() => ({ texture: new THREE.Texture(), dispose() { this.texture.dispose() } }))
  const world = keep(buildRenaissanceWorld({
    ...THREE,
    TextureLoader: class {
      load(_, complete) {
        const texture = new THREE.Texture()
        texture.image = { width: 1672, height: 941 }
        queueMicrotask(() => complete(texture))
        return texture
      }
    },
    PMREMGenerator: class { fromScene = generateEnvironment; dispose() {} },
  }, {}))
  expect(world.hasVisibleContent).toBe(false)
  expect(await world.ready).toBe(true)
  world.resize(width, height)
  return { world, generateEnvironment }
}
const update = (world, values = {}) => world.update({ elapsed: 0, delta: 0.016, progress: 0, pointerX: 0, pointerY: 0, reduced: false, ...values })
const submittedMeshes = (world) => {
  world.scene.updateMatrixWorld(true)
  const matrix = new THREE.Matrix4().multiplyMatrices(world.camera.projectionMatrix, world.camera.matrixWorldInverse)
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix)
  return world.scene.children.filter((mesh) => mesh.isMesh && mesh.visible && (!mesh.frustumCulled || frustum.intersectsObject(mesh)))
}

describe('cloud geometry clipping', () => {
  it('preserves the source UVs and every triangle that could have visible cloud alpha', () => {
    const original = keep(new THREE.PlaneGeometry(1, 1, 64, 36))
    const clipped = keep(createCloudGeometry(THREE))
    expect(clipped.attributes.position.array).toEqual(original.attributes.position.array)
    expect(clipped.attributes.uv.array).toEqual(original.attributes.uv.array)
    expect(clipped.index.count / 3).toBe(2000)
    const retained = new Set()
    for (let i = 0; i < clipped.index.count; i += 3) retained.add(Array.from(clipped.index.array.slice(i, i + 3)).join(','))
    let boundaryTriangles = 0
    const uv = original.attributes.uv
    for (let i = 0; i < original.index.count; i += 3) {
      const indices = Array.from(original.index.array.slice(i, i + 3))
      const points = indices.map((index) => [uv.getX(index), uv.getY(index)])
      const exists = retained.has(indices.join(','))
      let nonzero = false, zero = false
      // Convex samples include corners and the mask's boundary-crossing triangles.
      for (let a = 0; a <= 8; a += 1) for (let b = 0; b <= 8 - a; b += 1) {
        const weights = [a / 8, b / 8, 1 - (a + b) / 8]
        const u = points.reduce((sum, point, index) => sum + point[0] * weights[index], 0)
        const v = points.reduce((sum, point, index) => sum + point[1] * weights[index], 0)
        const alpha = smooth(0.46, 0.73, v) * smooth(0.12, 0.4, Math.abs(u - 0.5))
        if (alpha > 0) nonzero = true
        else zero = true
        if (!exists) expect(alpha).toBe(0)
      }
      if (nonzero) expect(exists).toBe(true)
      if (nonzero && zero) boundaryTriangles += 1
    }
    expect(boundaryTriangles).toBeGreaterThan(50)
  })
})

describe('analytic ribbon surface', () => {
  it('matches numerical derivatives throughout the animation and across the half-twist seam', () => {
    const epsilon = 0.000001
    for (const time of [0, 0.3, 3, 19, 70]) for (let i = 0; i < 48; i += 1) {
      const u = i / 48 * Math.PI * 2, v = (i * 0.61803398875 % 1) * Math.PI * 2
      const sample = sampleRibbonSurface(u, v, time)
      const up = sampleRibbonSurface(u + epsilon, v, time).position
      const down = sampleRibbonSurface(u - epsilon, v, time).position
      const right = sampleRibbonSurface(u, v + epsilon, time).position
      const left = sampleRibbonSurface(u, v - epsilon, time).position
      for (let axis = 0; axis < 3; axis += 1) {
        expect(sample.du[axis]).toBeCloseTo((up[axis] - down[axis]) / (2 * epsilon), 8)
        expect(sample.dv[axis]).toBeCloseTo((right[axis] - left[axis]) / (2 * epsilon), 8)
      }
      const normal = new THREE.Vector3(...sample.du).cross(new THREE.Vector3(...sample.dv))
      expect(normal.length()).toBeGreaterThan(0.07)
      const end = sampleRibbonSurface(u + Math.PI * 2, v, time)
      const start = sampleRibbonSurface(u, v + Math.PI, time)
      for (const key of ['position', 'du', 'dv']) for (let axis = 0; axis < 3; axis += 1) {
        expect(end[key][axis]).toBeCloseTo(start[key][axis], 11)
      }
    }
  })

  it('uses the same smooth geometry and a single GPU surface evaluation for position and normal', async () => {
    const geometry = keep(createRibbonGeometry(THREE))
    expect(geometry.index.count / 3).toBe(9216)
    const uv = geometry.attributes.aRibbon
    for (let i = 0; i < uv.count; i += 37) {
      const sample = sampleRibbonSurface(uv.getX(i), uv.getY(i))
      const normal = new THREE.Vector3(...sample.du).cross(new THREE.Vector3(...sample.dv)).normalize()
      expect(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).distanceTo(new THREE.Vector3(...sample.position))).toBeLessThan(0.000001)
      expect(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, i).distanceTo(normal)).toBeLessThan(0.000001)
      for (const time of [0, 5, 70]) {
        const position = new THREE.Vector3(...sampleRibbonSurface(uv.getX(i), uv.getY(i), time).position)
        expect(geometry.boundingSphere.containsPoint(position)).toBe(true)
      }
    }
    // The last row joins the first at v+PI, preserving the original half-twist.
    expect(Array.from(geometry.index.array.slice(-144, -138))).toEqual([4584, 12, 4585, 4585, 12, 13])
    const { world } = await makeWorld()
    const material = world.scene.getObjectByName('renaissance-liquid-chrome').material
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    }
    material.onBeforeCompile(shader)
    expect(shader.vertexShader.match(/liquidRibbon\(/g)).toHaveLength(2) // definition + one call
    expect(shader.vertexShader).toContain('cross(ribbonDU,ribbonDV)')
    expect(shader.vertexShader).toContain('vec3 transformed=ribbonPosition;')
    expect(shader.vertexShader).not.toContain('0.001')
    expect(material.clearcoat).toBe(0.8)
    expect(material.roughness).toBe(0.15)
  })
})

describe('draw eligibility and immediate pose updates', () => {
  it('skips only guaranteed-discarded sheets and restores all draws on reverse scrolling', async () => {
    const { world, generateEnvironment } = await makeWorld()
    update(world)
    expect(submittedMeshes(world)).toHaveLength(6)
    expect(submittedMeshes(world).reduce((sum, mesh) => sum + mesh.geometry.index.count / 3, 0)).toBe(22304)
    const planes = world.scene.children.filter((mesh) => mesh.isMesh && mesh.material.uniforms?.uDissolve)
    expect(planes.every((plane) => plane.material.forceSinglePass)).toBe(true)
    update(world, { progress: 0.94 })
    expect(submittedMeshes(world).map((mesh) => mesh.name)).toEqual(['renaissance-garden', 'renaissance-liquid-chrome'])
    update(world, { progress: 0.95 })
    expect(submittedMeshes(world).map((mesh) => mesh.name)).toEqual(['renaissance-liquid-chrome'])
    for (const plane of planes) {
      const dissolve = plane.material.uniforms.uDissolve.value
      const base = plane.material.uniforms.uCloud.value ? 0.17 : 1
      expect(maximumPlaneAlpha(dissolve, base)).toBeLessThan(0.012)
      for (const grain of [0, 0.2, 0.8, 0.99, 1]) {
        const alpha = base * smooth(dissolve - 0.045, dissolve + 0.045, grain) * (1 - smooth(0.5, 1.08, dissolve))
        expect(alpha).toBeLessThan(0.012)
      }
    }
    update(world, { progress: 1 })
    expect(submittedMeshes(world)).toHaveLength(0)
    expect(world.hasVisibleContent).toBe(false)
    update(world)
    expect(submittedMeshes(world)).toHaveLength(6)
    expect(world.hasVisibleContent).toBe(true)
    expect(generateEnvironment).toHaveBeenCalledOnce()
    world.dispose()
    expect(world.hasVisibleContent).toBe(false)
  })

  it('culls the departing figures without hiding in-view, shader-displaced fabric', async () => {
    const { world } = await makeWorld()
    const figures = ['renaissance-woman', 'renaissance-man'].map((name) => world.scene.getObjectByName(name))
    update(world, { progress: 0.85 })
    expect(figures.every((figure) => !figure.visible)).toBe(true)
    for (const [width, height] of [[1440, 900], [390, 844], [1920, 1080]]) {
      world.resize(width, height)
      for (const progress of [0, 0.25, 0.4, 0.55, 0.65, 0.85]) for (const pointer of [-1, 0, 1]) {
        const time = 4.3
        update(world, { progress, elapsed: time, pointerX: pointer, pointerY: -pointer })
        world.scene.updateMatrixWorld(true)
        for (const figure of figures) {
          const { position, uv } = figure.geometry.attributes
          for (let i = 0; i < position.count; i += 7) {
            const u = uv.getX(i), v = uv.getY(i)
            const cloth = (1 - smooth(0.42, 0.65, v)) * smooth(0.12, 0.43, Math.abs(u - 0.5))
            const point = new THREE.Vector3().fromBufferAttribute(position, i)
            point.x += cloth * Math.sin(time * 0.75 + v * 9) * 0.025
            point.z += cloth * Math.cos(time * 0.55 + u * 8) * 0.035
            point.applyMatrix4(figure.matrixWorld).project(world.camera)
            if (Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1) expect(figure.visible).toBe(true)
          }
        }
      }
    }
    world.resize(1440, 900)
    update(world)
    expect(figures.every((figure) => figure.visible)).toBe(true)
  })

  it('uses the hook pose directly without frame-rate or previous-frame lag', async () => {
    const { world } = await makeWorld()
    const { world: fresh } = await makeWorld()
    update(world, { progress: 1, pointerX: -1, elapsed: 40 })
    const target = { progress: 0.4, pointerX: 0.8, pointerY: -0.7, elapsed: 7 }
    update(world, { ...target, delta: 0.0001 })
    update(fresh, { ...target, delta: 1 })
    expect(world.camera.position.toArray()).toEqual(fresh.camera.position.toArray())
    expect(world.camera.quaternion.toArray()).toEqual(fresh.camera.quaternion.toArray())
    for (const name of ['renaissance-woman', 'renaissance-man', 'renaissance-liquid-chrome']) {
      const actual = world.scene.getObjectByName(name), expected = fresh.scene.getObjectByName(name)
      expect(actual.position.toArray()).toEqual(expected.position.toArray())
      expect(actual.rotation.toArray()).toEqual(expected.rotation.toArray())
      expect(actual.visible).toBe(expected.visible)
    }
    world.resize(390, 844)
    fresh.resize(390, 844)
    update(world, { reduced: true, elapsed: 99 })
    update(fresh, { reduced: true, elapsed: 1 })
    expect(world.camera.position.toArray()).toEqual(fresh.camera.position.toArray())
    expect(world.scene.getObjectByName('renaissance-liquid-chrome').rotation.toArray()).toEqual(fresh.scene.getObjectByName('renaissance-liquid-chrome').rotation.toArray())
  })
})
