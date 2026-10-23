import { useRef } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import useEditionChoreography from '../src/hooks/useEditionChoreography'

function Fixture({ enabled = true, withStory = false }) {
  const root = useRef(null)
  useEditionChoreography(root, enabled)
  return <main ref={root} className="edition-home" data-testid="edition">
    <section id="edition-reading"><header className="edition-section-heading"><h2>Keep reading</h2></header></section>
    <div className="tech-feature__visual" data-testid="photograph">Real news photograph</div>
    {withStory ? <article className="news-list-story">A newly loaded report</article> : null}
  </main>
}

function motionEnvironment(reduced = false) {
  let nextFrame = 0
  const frames = new Map()
  const observers = []
  const preference = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frames.set(++nextFrame, callback); return nextFrame }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)))
  vi.stubGlobal('IntersectionObserver', class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    constructor(callback) { this.callback = callback; observers.push(this) }
  })
  return {
    preference, observers, frames,
    flush() { act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()) }) },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

it('leaves readable base content when observers are unavailable or motion is reduced', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  const unavailable = render(<Fixture />)
  expect(screen.getByTestId('edition')).not.toHaveClass('edition-choreography')
  expect(screen.getByRole('heading', { name: 'Keep reading' })).toBeVisible()
  unavailable.unmount()

  const env = motionEnvironment(true)
  render(<Fixture />)
  expect(env.observers).toHaveLength(0)
  expect(screen.getByTestId('edition')).not.toHaveClass('edition-choreography')
  const onChange = env.preference.addEventListener.mock.calls[0][1]
  act(() => { env.preference.matches = false; onChange() })
  expect(screen.getByTestId('edition')).toHaveClass('edition-choreography')
  act(() => { env.preference.matches = true; onChange() })
  expect(screen.getByTestId('edition')).not.toHaveClass('edition-choreography')
  expect(screen.getByRole('heading', { name: 'Keep reading' })).not.toHaveClass('edition-motion-title')
  expect(screen.getByTestId('photograph').style.getPropertyValue('--entry-progress')).toBe('')
})

it('updates only on demand and clears observers, frames, styles and listeners when disabled', () => {
  const env = motionEnvironment()
  const addListener = vi.spyOn(window, 'addEventListener')
  const removeListener = vi.spyOn(window, 'removeEventListener')
  const { rerender } = render(<Fixture />)
  const root = screen.getByTestId('edition')
  const photograph = screen.getByTestId('photograph')
  photograph.getBoundingClientRect = () => ({ top: 600, height: 300 })
  env.flush()
  act(() => env.observers[0].callback([{ target: photograph, isIntersecting: true }]))
  env.flush()
  expect(Number(photograph.style.getPropertyValue('--entry-progress'))).toBeGreaterThan(0)
  expect(Number(photograph.style.getPropertyValue('--entry-progress'))).toBeLessThan(1)
  expect(env.frames.size).toBe(0)

  act(() => env.observers[0].callback([{ target: photograph, isIntersecting: false }]))
  act(() => window.dispatchEvent(new Event('scroll')))
  expect(env.frames.size).toBe(0)

  const scrollListener = addListener.mock.calls.find(([name]) => name === 'scroll')[1]
  act(() => env.observers[0].callback([{ target: photograph, isIntersecting: true }]))
  expect(env.frames.size).toBe(1)
  rerender(<Fixture enabled={false} />)
  expect(env.frames.size).toBe(0)
  expect(env.observers[0].disconnect).toHaveBeenCalledTimes(1)
  expect(removeListener).toHaveBeenCalledWith('scroll', scrollListener)
  expect(root).not.toHaveClass('edition-choreography')
  expect(photograph.style.getPropertyValue('--entry-progress')).toBe('')
  expect(env.preference.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
})

it('keeps a directly shared chapter visible and discovers reports loaded after mount', async () => {
  window.history.replaceState({}, '', '/#edition-reading')
  motionEnvironment()
  const { rerender } = render(<Fixture />)
  expect(screen.getByRole('heading', { name: 'Keep reading' })).toHaveClass('edition-is-revealed')
  rerender(<Fixture withStory />)
  await waitFor(() => expect(screen.getByRole('article')).toHaveClass('edition-motion-story'))
})
