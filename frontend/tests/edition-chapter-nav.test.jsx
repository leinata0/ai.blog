import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import EditionChapterNav from '../src/components/news/EditionChapterNav'
import EditionHero from '../src/components/news/EditionHero'

vi.mock('../src/hooks/useEditionScene', () => ({ default: vi.fn() }))
vi.mock('../src/components/news/IntelligenceSculpture', () => ({ default: () => null }))

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
  expect(screen.getByRole('link', { name: '新闻一览' })).toHaveAttribute('aria-current', 'location')
  expect(screen.getByRole('link', { name: '焦点报道' })).not.toHaveAttribute('aria-current')
  unmount()
  expect(disconnect).toHaveBeenCalledTimes(1)
})

it('keeps all four native anchor links usable without IntersectionObserver', async () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  render(<EditionChapterNav />)
  const links = screen.getAllByRole('link')
  expect(links.map((link) => link.getAttribute('href'))).toEqual(IDS.map((id) => `#${id}`))
  expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['焦点报道', '新闻一览', '主题档案', '阅读与订阅'])
  await userEvent.click(screen.getByRole('link', { name: '主题档案' }))
  expect(screen.getByRole('link', { name: '主题档案' })).toHaveAttribute('aria-current', 'location')
})

it('uses the same newsroom chapter order, labels and stable URLs in the cover and floating directory', () => {
  vi.stubGlobal('IntersectionObserver', undefined)
  render(<><EditionHero total={141} latestDate={new Date('2026-07-26T14:14:07Z')} /><EditionChapterNav /></>)
  const titles = ['焦点报道', '新闻一览', '主题档案', '阅读与订阅']
  const numerals = ['I', 'II', 'III', 'IV']
  for (const label of ['本期阅读目录', '本期展览目录']) {
    const links = within(screen.getByRole('navigation', { name: label })).getAllByRole('link')
    expect(links).toHaveLength(4)
    links.forEach((link, index) => {
      expect(link).toHaveAttribute('href', `#${IDS[index]}`)
      expect(within(link).getByText(titles[index])).toBeInTheDocument()
      expect(within(link).getByText(numerals[index])).toBeInTheDocument()
    })
  }
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
