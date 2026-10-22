import { act, render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import IntelligenceSculpture from '../src/components/news/IntelligenceSculpture'

const gpu = vi.hoisted(() => ({ renderers: [], environments: [], fail: false }))
vi.mock('three', async (original) => {
  const THREE = await original()
  return {
    ...THREE,
    WebGLRenderer: class {
      constructor() {
        if (gpu.fail) throw new Error('WebGL is unavailable')
        this.domElement = document.createElement('canvas')
        this.setClearColor = vi.fn()
        this.setPixelRatio = vi.fn()
        this.setSize = vi.fn()
        this.rotations = []
        this.render = vi.fn((scene, camera) => {
          this.scene = scene
          this.camera = camera
          this.rotations.push(scene.getObjectByName('signal-observatory').rotation.y)
        })
        this.dispose = vi.fn()
        this.forceContextLoss = vi.fn()
        gpu.renderers.push(this)
      }
    },
    PMREMGenerator: class {
      fromScene() {
        const environment = { texture: new THREE.Texture(), dispose: vi.fn() }
        gpu.environments.push(environment)
        return environment
      }
      dispose() {}
    },
  }
})

let frames, nextFrame, intersections, resizes, media, hidden, bounds
beforeEach(() => {
  gpu.renderers.length = 0
  gpu.environments.length = 0
  gpu.fail = false
  frames = new Map()
  nextFrame = 0
  intersections = []
  resizes = []
  hidden = false
  bounds = { width: 500, height: 500 }
  media = { matches: false, addEventListener: vi.fn((_, fn) => { media.change = fn }), removeEventListener: vi.fn() }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('WebGL2RenderingContext', class {})
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.set(++nextFrame, callback); return nextFrame }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)))
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); intersections.push(this) }
  })
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); resizes.push(this) }
  })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.hidden })

async function mount(props = {}) {
  const scene = document.createElement('section')
  scene.style.setProperty('--scene-progress', '0.5')
  scene.style.setProperty('--pointer-x', '1')
  const sceneRef = { current: scene }
  const view = render(<IntelligenceSculpture sceneRef={sceneRef} {...props} />)
  await waitFor(() => expect(view.container.firstChild).toHaveClass('intelligence-sculpture--ready'))
  return { ...view, sceneRef, renderer: gpu.renderers[0] }
}
function visible(value) { act(() => intersections[0].callback([{ isIntersecting: value }])) }
function frame(time) {
  act(() => {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach((callback) => callback(time))
  })
}

it('prerenders an accessible static decoration without constructing a WebGL renderer', () => {
  expect(renderToString(<IntelligenceSculpture />)).toContain('data-fallback="signal-observatory"')
  expect(renderToString(<IntelligenceSculpture />)).toContain('aria-hidden="true"')
  expect(gpu.renderers).toHaveLength(0)
})

it('builds a concave physical antenna and flies through the star field into a signal array', async () => {
  const { renderer, sceneRef } = await mount()
  sceneRef.current.style.setProperty('--scene-progress', '0')
  visible(true)
  frame(0)
  const dish = renderer.scene.getObjectByName('parabolic-dish')
  expect(dish.getObjectByName('three-feed-supports').children).toHaveLength(3)
  expect(dish.getObjectByName('blue-signal-receiver')).toBeDefined()
  const surface = dish.getObjectByName('perforated-reflector-panel')
  surface.geometry.computeBoundingBox()
  expect(surface.geometry.boundingBox.max.z - surface.geometry.boundingBox.min.z).toBeGreaterThan(0.9)
  expect(surface.material.alphaMap).toBeDefined()
  const layers = renderer.scene.children.filter((object) => object.name.startsWith('signal-stars-'))
  expect(layers).toHaveLength(3)
  expect(layers.reduce((sum, layer) => sum + layer.geometry.getAttribute('position').count, 0)).toBe(2040)
  expect(renderer.camera.position.z).toBeGreaterThan(10)
  sceneRef.current.style.setProperty('--scene-progress', '0.97')
  for (let time = 50; time <= 1500; time += 50) frame(time)
  expect(renderer.camera.position.z).toBeLessThan(-28)
  expect(renderer.scene.getObjectByName('signal-observatory').visible).toBe(false)
  expect(layers[0].geometry.getAttribute('position').getZ(0)).toBe(-53)
})

it('rotates only while visible and active, and disposes the GPU plus observers on unmount', async () => {
  const { renderer, unmount } = await mount()
  expect(frames.size).toBe(0)
  visible(true)
  frame(0)
  frame(100)
  expect(renderer.rotations[1]).toBeGreaterThan(renderer.rotations[0])
  expect(renderer.setClearColor).toHaveBeenCalledWith(0, 0)
  expect(renderer.domElement).toHaveAttribute('aria-hidden', 'true')
  visible(false)
  expect(frames.size).toBe(0)
  visible(true)
  expect(frames.size).toBe(1)
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
  expect(frames.size).toBe(0)
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
  expect(frames.size).toBe(1)
  unmount()
  expect(frames.size).toBe(0)
  expect(renderer.dispose).toHaveBeenCalledOnce()
  expect(renderer.forceContextLoss).toHaveBeenCalledOnce()
  expect(gpu.environments[0].dispose).toHaveBeenCalledOnce()
  expect(intersections[0].disconnect).toHaveBeenCalledOnce()
  expect(resizes[0].disconnect).toHaveBeenCalledOnce()
})

it('freezes without recreating WebGL when paused, resumes, and respects reduced motion', async () => {
  const { renderer, sceneRef, rerender } = await mount()
  visible(true)
  frame(0)
  frame(100)
  rerender(<IntelligenceSculpture sceneRef={sceneRef} paused />)
  expect(frames.size).toBe(0)
  const frozen = renderer.rotations.at(-1)
  rerender(<IntelligenceSculpture sceneRef={sceneRef} />)
  frame(200)
  expect(renderer.rotations.at(-1)).toBe(frozen)
  frame(300)
  expect(renderer.rotations.at(-1)).toBeGreaterThan(frozen)
  act(() => { media.matches = true; media.change() })
  expect(frames.size).toBe(0)
  expect(renderer.rotations.at(-1)).toBe(0)
  expect(gpu.renderers).toHaveLength(1)
})

it('renders one still frame with reduced motion and updates size with a capped pixel ratio', async () => {
  media.matches = true
  vi.stubGlobal('devicePixelRatio', 3)
  const { renderer } = await mount()
  visible(true)
  expect(renderer.render).toHaveBeenCalledOnce()
  expect(frames.size).toBe(0)
  act(() => { bounds = { width: 320, height: 400 }; resizes[0].callback() })
  expect(renderer.setSize).toHaveBeenLastCalledWith(320, 400, false)
  expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5)
  expect(renderer.render).toHaveBeenCalledTimes(2)
  expect(frames.size).toBe(0)
})

it('keeps the static decoration for unavailable or lost WebGL contexts', async () => {
  vi.stubGlobal('WebGL2RenderingContext', undefined)
  const unsupported = render(<IntelligenceSculpture />)
  expect(unsupported.container.querySelector('canvas')).toBeNull()
  expect(gpu.renderers).toHaveLength(0)
  unsupported.unmount()
  vi.stubGlobal('WebGL2RenderingContext', class {})
  gpu.fail = true
  const failed = render(<IntelligenceSculpture />)
  await act(async () => { await import('three') })
  expect(failed.container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  expect(failed.container.querySelector('[data-fallback="signal-observatory"]')).toBeInTheDocument()
  failed.unmount()
  gpu.fail = false
  const { renderer, container } = await mount()
  visible(true)
  act(() => renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true })))
  expect(container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  expect(container.querySelector('canvas')).toBeNull()
  expect(frames.size).toBe(0)
  expect(renderer.dispose).toHaveBeenCalledOnce()
})
