import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import IntelligenceSculpture from '../src/components/news/IntelligenceSculpture'
import { ensureEditionSceneState } from '../src/utils/editionSceneState'
import { optimizedImageUrl } from '../src/utils/responsiveImage'

const gpu = vi.hoisted(() => ({ renderers: [], environments: [], loads: [], autoLoad: true, fail: false }))
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
        this.clear = vi.fn()
        this.rotations = []
        this.render = vi.fn((scene, camera) => {
          this.scene = scene
          this.camera = camera
          this.rotations.push(scene.getObjectByName('renaissance-liquid-chrome').rotation.y)
        })
        this.dispose = vi.fn()
        this.forceContextLoss = vi.fn()
        gpu.renderers.push(this)
      }
    },
    TextureLoader: class {
      load(url, onLoad, _, onError) {
        const texture = new THREE.Texture()
        texture.image = { width: 1672, height: 941 }
        texture.dispose = vi.fn()
        const job = { url, texture, complete: () => onLoad(texture), reject: () => onError(new Error('Asset unavailable')) }
        gpu.loads.push(job)
        if (gpu.autoLoad) queueMicrotask(job.complete)
        return texture
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
  gpu.loads.length = 0
  gpu.autoLoad = true
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
  Object.assign(ensureEditionSceneState(scene), { progress: 0.5, pointerX: 1 })
  const sceneRef = { current: scene }
  const view = render(<IntelligenceSculpture sceneRef={sceneRef} {...props} />)
  await waitFor(() => expect(gpu.environments).toHaveLength(1))
  visible(true)
  frame(0)
  await waitFor(() => expect(view.container.firstChild).toHaveClass('intelligence-sculpture--ready'))
  visible(false)
  gpu.renderers[0].rotations.length = 0
  return { ...view, sceneRef, renderer: gpu.renderers[0] }
}
function visible(value) { act(() => intersections.at(-1).callback([{ isIntersecting: value }])) }
function frame(time) {
  act(() => {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach((callback) => callback(time))
  })
}

it('prerenders an accessible static decoration without constructing a WebGL renderer', () => {
  expect(renderToString(<IntelligenceSculpture />)).toContain('data-fallback="renaissance-world"')
  expect(renderToString(<IntelligenceSculpture />)).toContain(optimizedImageUrl('/images/renaissance-edition/figures.png'))
  expect(renderToString(<IntelligenceSculpture />)).toContain('aria-hidden="true"')
  expect(gpu.renderers).toHaveLength(0)
})

it('reveals WebGL only after both art textures and the first visible frame are ready', async () => {
  gpu.autoLoad = false
  const { container } = render(<IntelligenceSculpture />)
  await waitFor(() => expect(gpu.loads).toHaveLength(2))
  visible(true)
  expect(container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  expect(frames.size).toBe(0)
  await act(async () => gpu.loads[0].complete())
  expect(container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  await act(async () => gpu.loads[1].complete())
  expect(container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  frame(0)
  expect(container.firstChild).toHaveClass('intelligence-sculpture--ready')
  const scene = gpu.renderers[0].scene
  const woman = scene.getObjectByName('renaissance-woman')
  const man = scene.getObjectByName('renaissance-man')
  expect(woman.material.uniforms.uMap.value).toBe(man.material.uniforms.uMap.value)
  expect(woman.material.uniforms.uHalf.value).toBe(0)
  expect(man.material.uniforms.uHalf.value).toBe(0.5)
  expect(woman.position.x).toBeLessThan(0)
  expect(man.position.x).toBeGreaterThan(0)
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

it('keeps a clearly changing foreground pose during eight seconds of idle time', async () => {
  const { renderer, sceneRef } = await mount()
  ensureEditionSceneState(sceneRef.current).progress = 0
  visible(true)
  frame(0)
  const initial = renderer.rotations.at(-1)
  for (let time = 50; time <= 8000; time += 50) frame(time)
  expect(renderer.rotations.at(-1) - initial).toBeGreaterThan(0.7)
  expect(renderer.rotations.at(-1) - initial).toBeLessThan(1)
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
  expect(renderer.rotations.at(-1)).toBe(-0.45)
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
  expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(1)
  expect(renderer.render).toHaveBeenCalledTimes(2)
  expect(frames.size).toBe(0)
})

it('clears a dissolved scene once and resumes drawing when reverse scrolling restores it', async () => {
  const { renderer, sceneRef } = await mount()
  visible(true)
  frame(0)
  const drawn = renderer.render.mock.calls.length
  ensureEditionSceneState(sceneRef.current).progress = 1
  frame(16)
  frame(32)
  expect(renderer.render).toHaveBeenCalledTimes(drawn)
  expect(renderer.clear).toHaveBeenCalledOnce()
  ensureEditionSceneState(sceneRef.current).progress = 0
  frame(48)
  expect(renderer.render).toHaveBeenCalledTimes(drawn + 1)
  expect(renderer.scene.getObjectByName('renaissance-woman').visible).toBe(true)
})

it('presents a clear first frame when restored at the dissolved end, without leaving fallback art', async () => {
  const scene = document.createElement('section')
  ensureEditionSceneState(scene).progress = 1
  const { container } = render(<IntelligenceSculpture sceneRef={{ current: scene }} />)
  await waitFor(() => expect(gpu.environments).toHaveLength(1))
  const renderer = gpu.renderers[0]
  visible(true)
  frame(0)
  expect(renderer.render).not.toHaveBeenCalled()
  expect(renderer.clear).toHaveBeenCalledOnce()
  expect(container.firstChild).toHaveClass('intelligence-sculpture--ready')
  frame(16)
  expect(renderer.clear).toHaveBeenCalledOnce()
  ensureEditionSceneState(scene).progress = 0
  frame(32)
  expect(renderer.render).toHaveBeenCalledOnce()
})

it('adapts only the canvas after sustained slow frames without recreating WebGL', async () => {
  const { renderer } = await mount()
  visible(true)
  frame(0)
  const sizes = renderer.setSize.mock.calls.length
  for (let time = 40; time <= 2200; time += 40) frame(time)
  expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(0.85)
  expect(renderer.setSize).toHaveBeenCalledTimes(sizes + 1)
  expect(renderer.dispose).not.toHaveBeenCalled()
  expect(gpu.renderers).toHaveLength(1)
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
  expect(failed.container.querySelector('[data-fallback="renaissance-world"]')).toBeInTheDocument()
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

it('releases failed or pending texture loads and cannot reveal WebGL after unmount', async () => {
  gpu.autoLoad = false
  const first = render(<IntelligenceSculpture />)
  await waitFor(() => expect(gpu.loads).toHaveLength(2))
  await act(async () => gpu.loads[0].reject())
  await waitFor(() => expect(gpu.loads).toHaveLength(3))
  expect(gpu.loads[2].url).toBe('/images/renaissance-edition/world.jpg')
  await act(async () => gpu.loads[2].reject())
  expect(first.container.querySelector('canvas')).toBeNull()
  expect(first.container.firstChild).not.toHaveClass('intelligence-sculpture--ready')
  expect(gpu.renderers[0].dispose).toHaveBeenCalledOnce()
  first.unmount()
  gpu.loads.length = 0
  const second = render(<IntelligenceSculpture />)
  await waitFor(() => expect(gpu.loads).toHaveLength(2))
  const renderer = gpu.renderers.at(-1)
  second.unmount()
  await act(async () => gpu.loads.forEach((job) => job.complete()))
  expect(renderer.render).not.toHaveBeenCalled()
  expect(renderer.dispose).toHaveBeenCalledOnce()
  expect(gpu.environments).toHaveLength(0)
  expect(gpu.loads.every((job) => job.texture.dispose.mock.calls.length > 0)).toBe(true)
})

it('recovers missing optimized artwork with original textures and static fallback images', async () => {
  gpu.autoLoad = false
  const { container } = render(<IntelligenceSculpture />)
  await waitFor(() => expect(gpu.loads).toHaveLength(2))
  await act(async () => gpu.loads[1].reject())
  await waitFor(() => expect(gpu.loads).toHaveLength(3))
  expect(gpu.loads[2].url).toBe('/images/renaissance-edition/figures.png')
  await act(async () => { gpu.loads[0].complete(); gpu.loads[2].complete() })
  expect(gpu.environments).toHaveLength(1)
  const garden = container.querySelector('.intelligence-sculpture__garden')
  const figure = container.querySelector('.intelligence-sculpture__figure img')
  fireEvent.error(garden)
  fireEvent.error(figure)
  expect(garden).toHaveAttribute('src', '/images/renaissance-edition/world.jpg')
  expect(figure).toHaveAttribute('src', '/images/renaissance-edition/figures.png')
})
