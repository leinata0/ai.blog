import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TechPageFrame from '../src/components/TechPageFrame'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const article = (key) => <article key={key} data-tech-reveal><a href={`#${key}`}>{key}</a></article>

it('reveals loaded content on entry, releases removed nodes, and disconnects on exit', async () => {
  let onEntry
  const observe = vi.fn()
  const unobserve = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal('IntersectionObserver', class { constructor(callback) { onEntry = callback } observe = observe; unobserve = unobserve; disconnect = disconnect })
  const { rerender, unmount } = render(<TechPageFrame section="daily" title="AI 日报">{article('first')}</TechPageFrame>)
  const first = screen.getByRole('link', { name: 'first' }).closest('article')
  expect(first).toHaveAttribute('data-tech-pending')
  act(() => onEntry([{ target: first, isIntersecting: true }]))
  expect(first).not.toHaveAttribute('data-tech-pending')
  rerender(<TechPageFrame section="daily" title="AI 日报">{article('waiting')}</TechPageFrame>)
  const waiting = screen.getByRole('link', { name: 'waiting' }).closest('article')
  await waitFor(() => expect(waiting).toHaveAttribute('data-tech-pending'))
  rerender(<TechPageFrame section="daily" title="AI 日报">{article('newer')}</TechPageFrame>)
  await waitFor(() => expect(unobserve).toHaveBeenCalledWith(waiting))
  unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})

it('keeps all content immediately readable when reduced motion is requested', () => {
  const createObserver = vi.fn()
  vi.stubGlobal('IntersectionObserver', createObserver)
  vi.stubGlobal('matchMedia', (media) => ({ media, matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const { container } = render(<TechPageFrame section="weekly" title="AI 周报" visual={<div>真实封面</div>}>{article('weekly')}</TechPageFrame>)
  expect(container.querySelector('[data-tech-pending]')).toBeNull()
  expect(screen.getByRole('heading', { name: 'AI 周报' })).toBeInTheDocument()
  expect(createObserver).not.toHaveBeenCalled()
})
