import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useReelScroll from '../src/components/news/daily/useReelScroll'

let now
let nextFrame
let frames
let scrollTo
let track

function advanceFrame(milliseconds) {
  now += milliseconds
  const pending = [...frames.values()]
  frames.clear()
  act(() => pending.forEach((callback) => callback(now)))
}

beforeEach(() => {
  now = 0
  nextFrame = 0
  frames = new Map()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id) => frames.delete(id))
  vi.stubGlobal('innerHeight', 1000)
  vi.stubGlobal('scrollY', 300)
  scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(({ top }) => { window.scrollY = top })
  track = { current: { offsetHeight: 2700, getBoundingClientRect: () => ({ top: 300 - window.scrollY }) } }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reverses from the actual current position without letting the old jump continue', () => {
  const { result, rerender } = renderHook(() => useReelScroll(track))
  const goTo = result.current
  rerender()
  expect(result.current).toBe(goTo)
  act(() => goTo(2))
  advanceFrame(260)
  const reversal = window.scrollY
  expect(reversal).toBeGreaterThan(300)
  expect(reversal).toBeLessThan(1898)
  act(() => goTo(0))
  expect(window.scrollY).toBe(reversal)
  expect(frames.size).toBe(1)
  advanceFrame(200)
  expect(window.scrollY).toBeLessThan(reversal)
  expect(window.scrollY).toBeGreaterThan(300)
  advanceFrame(1000)
  expect(window.scrollY).toBe(300)
  expect(frames.size).toBe(0)
  expect(scrollTo.mock.calls.every(([options]) => options.behavior === 'instant')).toBe(true)
})

it('lets the previous control reverse a jump before the visible chapter has changed', () => {
  const { result } = renderHook(() => useReelScroll(track))
  act(() => result.current(1))
  advanceFrame(80)
  const reversal = window.scrollY
  expect(reversal).toBeGreaterThan(300)
  act(() => result.current((pending) => (pending + 2) % 3))
  advanceFrame(150)
  expect(window.scrollY).toBeLessThan(reversal)
  advanceFrame(1000)
  expect(window.scrollY).toBe(300)
  expect(frames.size).toBe(0)
})

it.each(['wheel', 'touchstart', 'resize'])('hands %s control back without more scroll writes', (type) => {
  const { result } = renderHook(() => useReelScroll(track))
  act(() => result.current(2))
  advanceFrame(100)
  const interrupted = window.scrollY
  const event = new Event(type, { cancelable: true })
  act(() => window.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  expect(frames.size).toBe(0)
  scrollTo.mockClear()
  advanceFrame(1000)
  expect(scrollTo).not.toHaveBeenCalled()
  expect(window.scrollY).toBe(interrupted)
})

it('only cancels keyboard input that can scroll, and a new jump uses the reader’s new position', () => {
  const { result } = renderHook(() => useReelScroll(track))
  act(() => result.current(1))
  act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })))
  expect(frames.size).toBe(1)
  const event = new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true })
  act(() => window.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(false)
  expect(frames.size).toBe(0)
  window.scrollY = 1400
  act(() => result.current(1))
  expect(window.scrollY).toBe(1400)
  advanceFrame(150)
  expect(window.scrollY).toBeLessThan(1400)
  expect(window.scrollY).toBeGreaterThan(1150)
  advanceFrame(1000)
  expect(window.scrollY).toBe(1150)
})

it('stops pending work on unmount and never animates while idle', () => {
  const { result, unmount } = renderHook(() => useReelScroll(track))
  expect(frames.size).toBe(0)
  act(() => result.current(2))
  advanceFrame(100)
  expect(frames.size).toBe(1)
  unmount()
  scrollTo.mockClear()
  expect(frames.size).toBe(0)
  advanceFrame(1000)
  expect(scrollTo).not.toHaveBeenCalled()
})
