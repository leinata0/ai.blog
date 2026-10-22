import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import EditionChapterNav from '../src/components/news/EditionChapterNav'

const IDS = ['edition-focus', 'edition-news', 'edition-topics', 'edition-reading']

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState({}, '', '/') })

it('follows visible sections and disconnects its observer on unmount', () => {
  let onIntersection
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { onIntersection = callback }
    observe = observe
    disconnect = disconnect
  })
  const { unmount } = render(<>{IDS.map((id) => <section key={id} id={id} />)}<EditionChapterNav /></>)
  expect(observe).toHaveBeenCalledTimes(4)
  act(() => onIntersection([{ target: document.getElementById('edition-news'), isIntersecting: true }]))
  expect(screen.getByRole('link', { name: '新闻档案' })).toHaveAttribute('aria-current', 'location')
  expect(screen.getByRole('link', { name: '本期焦点' })).not.toHaveAttribute('aria-current')
  unmount()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

it('keeps all four native anchor links usable without IntersectionObserver', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  render(<EditionChapterNav />)
  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`))
  await userEvent.click(screen.getByRole('link', { name: '领域探索' }))
  expect(screen.getByRole('link', { name: '领域探索' })).toHaveAttribute('aria-current', 'location')
})

it('keeps the floating directory off the cover and reveals it in the newsroom', () => {
  const callbacks = []
  const disconnects = []
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { callbacks.push(callback); this.disconnect = vi.fn(); disconnects.push(this.disconnect) }
    observe = vi.fn()
  })
  const { unmount } = render(<><section className="edition-hero" /><EditionChapterNav /></>)
  act(() => callbacks[0]([{ isIntersecting: true }]))
  expect(screen.queryByRole('navigation', { name: '本期展览目录' })).not.toBeInTheDocument()
  act(() => callbacks[0]([{ isIntersecting: false }]))
  expect(screen.getByRole('navigation', { name: '本期展览目录' })).toBeInTheDocument()
  unmount()
  expect(disconnects.every((disconnect) => disconnect.mock.calls.length > 0)).toBe(true)
})

it('restores a shared chapter URL after asynchronously loaded news has settled', () => {
  window.history.replaceState({}, '', '/#edition-reading')
  const frames = []
  vi.stubGlobal('requestAnimationFrame', (callback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const scrollToChapter = vi.fn()
  const chapter = <section id="edition-reading" ref={(node) => { if (node) node.scrollIntoView = scrollToChapter }} />
  const { rerender } = render(<>{chapter}<EditionChapterNav ready={false} /></>)
  expect(frames).toHaveLength(0)
  rerender(<>{chapter}<EditionChapterNav ready /></>)
  act(() => frames[0]())
  expect(scrollToChapter).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
})
