import { useRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import useEditionScene from '../src/hooks/useEditionScene'

const rectangle = (top, height) => ({ top, height, left: 0, width: 1440, bottom: top + height, right: 1440 })

function Fixture({ bounds, paused = false }) {
  const scene = useRef(null)
  useEditionScene(scene, paused)
  return <section data-testid="scene" ref={(node) => {
    scene.current = node
    if (node) node.getBoundingClientRect = () => rectangle(bounds.top, 2200)
  }}>
    <div className="edition-hero__stage" data-testid="stage" ref={(node) => {
      if (node) node.getBoundingClientRect = () => rectangle(0, 1000)
    }} />
  </section>
}

function motionEnvironment() {
  let now = 0
  let nextFrame = 0
  let hidden = false
  const frames = new Map()
  const observers = []
  const preferenceListeners = new Set()
  const preference = {
    matches: false,
    addEventListener: vi.fn((type, listener) => { if (type === 'change') preferenceListeners.add(listener) }),
    removeEventListener: vi.fn((type, listener) => { if (type === 'change') preferenceListeners.delete(listener) }),
  }
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => query.includes('prefers-reduced-motion')
    ? preference : { matches: true })
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)))
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(callback) { this.callback = callback; observers.push(this) }
  })

  function tick(milliseconds = 1000 / 60) {
    now += milliseconds
    const pending = [...frames.values()]
    frames.clear()
    act(() => pending.forEach((callback) => callback(now)))
  }

  return {
    frames, observers, preference, preferenceListeners, tick,
    advance(milliseconds, fps = 60) {
      let remaining = milliseconds
      while (remaining > .00001) {
        const duration = Math.min(1000 / fps, remaining)
        tick(duration)
        remaining -= duration
      }
    },
    settle() {
      for (let count = 0; count < 240 && frames.size; count += 1) tick()
      expect(frames.size).toBe(0)
    },
    setReduced(value) {
      act(() => {
        preference.matches = value
        preferenceListeners.forEach((listener) => listener())
      })
    },
    setHidden(value) {
      act(() => { hidden = value; document.dispatchEvent(new Event('visibilitychange')) })
    },
  }
}

const progressOf = (scene) => Number.parseFloat(scene.style.getPropertyValue('--scene-progress'))
const scroll = (bounds, top) => {
  bounds.top = top
  act(() => window.dispatchEvent(new Event('scroll')))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('eases a changed scroll target and keeps converging after scrolling stops', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  env.tick()
  expect(progressOf(scene)).toBe(0)
  expect(env.frames.size).toBe(0)

  scroll(bounds, -1200)
  scroll(bounds, -1200)
  expect(env.frames.size).toBe(1)
  env.tick()
  const first = progressOf(scene)
  expect(first).toBeGreaterThan(0)
  expect(first).toBeLessThan(.5)
  expect(env.frames.size).toBe(1)

  let previous = first
  for (let count = 0; count < 12; count += 1) {
    env.tick()
    const next = progressOf(scene)
    expect(next).toBeGreaterThan(previous)
    expect(next).toBeLessThanOrEqual(1)
    previous = next
  }
  env.settle()
  expect(progressOf(scene)).toBeCloseTo(1, 3)

  // Reversing direction must also travel through intermediate poses.
  const settled = progressOf(scene)
  scroll(bounds, 0)
  env.tick()
  expect(progressOf(scene)).toBeGreaterThan(0)
  expect(progressOf(scene)).toBeLessThan(settled)
  env.settle()
  expect(progressOf(scene)).toBeCloseTo(0, 3)
})

it('advances by similar amounts at 30 and 120 fps over the same elapsed time', () => {
  const env = motionEnvironment()
  function runAt(fps) {
    const bounds = { top: 0 }
    const fixture = render(<Fixture bounds={bounds} />)
    const scene = screen.getByTestId('scene')
    env.tick(0)
    scroll(bounds, -1200)
    // Start both runs at the same input frame, then vary subsequent frame spacing.
    env.tick(0)
    env.advance(200, fps)
    const result = progressOf(scene)
    fixture.unmount()
    return result
  }
  const slow = runAt(30)
  const fast = runAt(120)
  expect(slow).toBeGreaterThan(0)
  expect(fast).toBeLessThan(1)
  expect(Math.abs(slow - fast)).toBeLessThan(.03)
})

it('cancels pending movement when paused and resumes without jumping to the target', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  const { rerender } = render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  env.tick()
  scroll(bounds, -1200)
  env.tick()
  const beforePause = progressOf(scene)
  expect(env.frames.size).toBe(1)

  rerender(<Fixture bounds={bounds} paused />)
  expect(env.frames.size).toBe(0)
  expect(scene.dataset.sceneActive).toBe('false')
  scroll(bounds, -1200)
  env.advance(1000)
  expect(env.frames.size).toBe(0)
  expect(progressOf(scene)).toBe(beforePause)
  expect(env.observers[0].disconnect).toHaveBeenCalledOnce()

  rerender(<Fixture bounds={bounds} />)
  expect(env.frames.size).toBe(1)
  env.tick()
  expect(progressOf(scene)).toBeGreaterThan(beforePause)
  expect(progressOf(scene)).toBeLessThan(1)
})

it('clears motion properties for reduced motion and responds to preference changes', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  env.tick()
  scroll(bounds, -1200)
  env.tick()
  expect(env.frames.size).toBe(1)

  env.setReduced(true)
  expect(env.frames.size).toBe(0)
  expect(scene.dataset.sceneMotion).toBe('reduced')
  expect(scene.dataset.sceneCoverHidden).toBe('false')
  expect(scene.style.getPropertyValue('--scene-progress')).toBe('')
  expect(scene.style.getPropertyValue('--pointer-x')).toBe('')
  scroll(bounds, -600)
  env.advance(1000)
  expect(env.frames.size).toBe(0)
  expect(scene.style.getPropertyValue('--scene-progress')).toBe('')

  env.setReduced(false)
  expect(env.frames.size).toBe(1)
  env.tick()
  expect(scene.dataset.sceneMotion).toBe('full')
  expect(progressOf(scene)).toBeGreaterThan(0)
  expect(progressOf(scene)).toBeLessThan(.5)
})

it('stops queued frames while hidden or offscreen, then resumes gradually', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  env.tick()
  scroll(bounds, -1200)
  env.tick()
  const beforeHiding = progressOf(scene)

  env.setHidden(true)
  expect(env.frames.size).toBe(0)
  scroll(bounds, -1200)
  env.advance(5000)
  expect(env.frames.size).toBe(0)
  expect(progressOf(scene)).toBe(beforeHiding)
  env.setHidden(false)
  env.tick()
  expect(progressOf(scene)).toBeGreaterThan(beforeHiding)
  expect(progressOf(scene)).toBeLessThan(1)

  act(() => env.observers[0].callback([{ isIntersecting: false }]))
  expect(env.frames.size).toBe(0)
  scroll(bounds, -1200)
  expect(env.frames.size).toBe(0)
  act(() => env.observers[0].callback([{ isIntersecting: true }]))
  expect(env.frames.size).toBe(1)
})

it('removes every scene listener, observer and queued frame on unmount', () => {
  const env = motionEnvironment()
  const add = vi.spyOn(EventTarget.prototype, 'addEventListener')
  const remove = vi.spyOn(EventTarget.prototype, 'removeEventListener')
  // jsdom exposes Window listeners through its own forwarding methods.
  const addWindow = vi.spyOn(window, 'addEventListener')
  const removeWindow = vi.spyOn(window, 'removeEventListener')
  const bounds = { top: 0 }
  const { unmount } = render(<Fixture bounds={bounds} />)
  const stage = screen.getByTestId('stage')
  env.tick()
  scroll(bounds, -1200)
  env.tick()
  expect(env.frames.size).toBe(1)

  const installed = add.mock.calls.flatMap(([type, listener], index) => {
    const target = add.mock.contexts[index]
    const belongsToScene = (target === document && type === 'visibilitychange')
      || (target === stage && ['pointermove', 'pointerleave'].includes(type))
    return belongsToScene ? [{ target, type, listener }] : []
  })
  installed.push(...addWindow.mock.calls.flatMap(([type, listener]) =>
    ['scroll', 'resize'].includes(type) ? [{ target: window, type, listener }] : []))
  expect(installed).toHaveLength(5)
  const preferenceListener = env.preference.addEventListener.mock.calls[0][1]
  unmount()

  expect(env.frames.size).toBe(0)
  expect(env.observers[0].disconnect).toHaveBeenCalledOnce()
  expect(env.preferenceListeners.size).toBe(0)
  expect(env.preference.removeEventListener).toHaveBeenCalledWith('change', preferenceListener)
  for (const { target, type, listener } of installed) {
    const removed = target === window ? removeWindow : remove
    expect(removed.mock.calls.some(([removedType, removedListener], index) =>
      removed.mock.contexts[index] === target && removedType === type && removedListener === listener)).toBe(true)
  }
  act(() => {
    window.dispatchEvent(new Event('scroll'))
    window.dispatchEvent(new Event('resize'))
    stage.dispatchEvent(new Event('pointerleave'))
  })
  env.setHidden(false)
  expect(env.frames.size).toBe(0)
})
