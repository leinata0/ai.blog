import { useRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import useEditionScene from '../src/hooks/useEditionScene'
import { getEditionSceneState } from '../src/utils/editionSceneState'

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
    }}>
      <div className="edition-cover" data-testid="cover" />
      <div className="edition-hero__masthead" data-testid="masthead" />
      <div className="edition-hero__chapter" data-testid="chapter" />
      <div className="edition-hero__light-wash" data-testid="wash" />
      <div className="edition-hero__foot" data-testid="foot" />
    </div>
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

const progressOf = (scene) => getEditionSceneState(scene).progress
const pointer = (stage, x, y) => act(() => stage.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y })))
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
  expect(getEditionSceneState(null)).toBeNull()
  expect(getEditionSceneState(document.createElement('section'))).toBeNull()
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
  pointer(screen.getByTestId('stage'), 1200, 800)
  env.tick()
  const state = getEditionSceneState(scene)
  const pose = { ...state }
  const beforePause = progressOf(scene)
  expect(env.frames.size).toBe(1)

  rerender(<Fixture bounds={bounds} paused />)
  expect(env.frames.size).toBe(0)
  expect(scene.dataset.sceneActive).toBe('false')
  scroll(bounds, -1200)
  env.advance(1000)
  expect(env.frames.size).toBe(0)
  expect(progressOf(scene)).toBe(beforePause)
  expect(getEditionSceneState(scene)).toBe(state)
  expect(state).toEqual(pose)
  expect(env.observers[0].disconnect).toHaveBeenCalledOnce()

  rerender(<Fixture bounds={bounds} />)
  expect(getEditionSceneState(scene)).toBe(state)
  expect(env.frames.size).toBe(1)
  env.tick()
  expect(progressOf(scene)).toBeGreaterThan(beforePause)
  expect(progressOf(scene)).toBeLessThan(1)
})

it('resets the shared pose and leaf styles for reduced motion and responds to preference changes', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  const state = getEditionSceneState(scene)
  env.tick()
  scroll(bounds, -1200)
  pointer(screen.getByTestId('stage'), 1200, 800)
  env.tick()
  expect(env.frames.size).toBe(1)

  env.setReduced(true)
  expect(env.frames.size).toBe(0)
  expect(scene.dataset.sceneMotion).toBe('reduced')
  expect(scene.dataset.sceneCoverHidden).toBe('false')
  expect(scene.style.getPropertyValue('--scene-progress')).toBe('')
  expect(scene.style.getPropertyValue('--pointer-x')).toBe('')
  expect(getEditionSceneState(scene)).toBe(state)
  expect(state).toEqual({ progress: 0, pointerX: 0, pointerY: 0 })
  expect(screen.getByTestId('cover').style.getPropertyValue('--scene-cover')).toBe('1.00000')
  expect(screen.getByTestId('chapter').style.getPropertyValue('--scene-reveal')).toBe('0.00000')
  expect(screen.getByTestId('wash').style.getPropertyValue('--scene-wipe')).toBe('0.00000')
  scroll(bounds, -600)
  env.advance(1000)
  expect(env.frames.size).toBe(0)
  expect(scene.style.getPropertyValue('--scene-progress')).toBe('')
  expect(state.progress).toBe(0)

  env.setReduced(false)
  expect(env.frames.size).toBe(1)
  env.tick()
  expect(scene.dataset.sceneMotion).toBe('full')
  expect(progressOf(scene)).toBeGreaterThan(0)
  expect(progressOf(scene)).toBeLessThan(.5)
})

it('uses cached geometry for pointer-only motion and performs no unchanged DOM writes', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  const stage = screen.getByTestId('stage')
  env.tick()
  const sceneMeasure = vi.spyOn(scene, 'getBoundingClientRect')
  const stageMeasure = vi.spyOn(stage, 'getBoundingClientRect')
  const mutations = new MutationObserver(() => {})
  mutations.observe(scene, { attributes: true, subtree: true })

  pointer(stage, 1000, 800)
  pointer(stage, 1300, 900)
  expect(env.frames.size).toBe(1)
  env.tick()
  const state = getEditionSceneState(scene)
  expect(state.pointerX).toBeGreaterThan(0)
  expect(state.pointerY).toBeGreaterThan(0)
  env.settle()
  expect(sceneMeasure).not.toHaveBeenCalled()
  expect(stageMeasure).not.toHaveBeenCalled()
  expect(mutations.takeRecords()).toHaveLength(0)

  // A geometry change is measured once on its frame, never once per input event.
  stageMeasure.mockReturnValue({ ...rectangle(0, 1000), left: 1000, right: 2440 })
  act(() => {
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
  })
  expect(sceneMeasure).not.toHaveBeenCalled()
  env.tick()
  expect(sceneMeasure).toHaveBeenCalledOnce()
  expect(stageMeasure).toHaveBeenCalledOnce()
  env.settle()
  expect(state.pointerX).toBeLessThan(0)
  mutations.disconnect()
})

it('limits DOM pose writes to changed leaf values and keeps the scene root free of animation styles', () => {
  const env = motionEnvironment()
  const bounds = { top: 0 }
  render(<Fixture bounds={bounds} />)
  const scene = screen.getByTestId('scene')
  env.tick()
  scroll(bounds, -600)
  env.settle()
  const cover = screen.getByTestId('cover')
  const masthead = screen.getByTestId('masthead')
  const chapter = screen.getByTestId('chapter')
  const wash = screen.getByTestId('wash')
  const foot = screen.getByTestId('foot')
  expect(cover.style.getPropertyValue('--scene-cover')).toBe('0.00000')
  expect(masthead.style.getPropertyValue('--scene-reveal')).toBe('1.00000')
  expect(chapter.style.getPropertyValue('--scene-reveal')).toBe('1.00000')
  expect(wash.style.getPropertyValue('--scene-wipe')).toBe('0.00000')
  expect(foot.style.getPropertyValue('--scene-wipe')).toBe('0.00000')
  expect(scene.getAttribute('style')).toBeNull()

  const mutations = new MutationObserver(() => {})
  mutations.observe(scene, { attributes: true, subtree: true })
  // These poses all share cover=0/reveal=1/wipe=0, while the WebGL pose keeps moving.
  scroll(bounds, -660)
  env.settle()
  expect(progressOf(scene)).toBeGreaterThan(.54)
  expect(mutations.takeRecords()).toHaveLength(0)
  mutations.disconnect()
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
