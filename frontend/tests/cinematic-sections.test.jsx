import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import CinematicNavigation from '../src/components/news/cinematic/CinematicNavigation'
import SectionCover from '../src/components/news/cinematic/SectionCover'

vi.mock('../src/components/Navbar', () => ({ default: ({ children }) => <header>{children}</header> }))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps all six section destinations with the correct current page', () => {
  render(<MemoryRouter initialEntries={['/series']}><div className="cinematic-section"><CinematicNavigation /><section className="cinema-hero" /></div></MemoryRouter>)
  expect(screen.getByRole('link', { name:'系列' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name:'日报' })).not.toHaveAttribute('aria-current')
  expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['/', '/daily', '/weekly', '/topics', '/series', '/start-here'])
})

it('changes header contrast after a direct jump below the hero and restores it on return', () => {
  let bottom = 950
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ bottom }))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(); return 0 })
  const { container } = render(<MemoryRouter><div className="cinematic-section"><CinematicNavigation /><section className="cinema-hero" /></div></MemoryRouter>)
  expect(container.querySelector('.cinema-navigation--paper')).toBeNull()
  act(() => { bottom = -500; window.dispatchEvent(new Event('scroll')) })
  expect(container.querySelector('.cinema-navigation--paper')).toBeTruthy()
  act(() => { bottom = 950; window.dispatchEvent(new Event('scroll')) })
  expect(container.querySelector('.cinema-navigation--paper')).toBeNull()
})

it('retains article identity when its cover fails and tries a newly selected cover', () => {
  const view = render(<SectionCover src="https://img.563118077.xyz/one.jpg" title="研究报道" eager />)
  expect(view.container.querySelector('img')).toHaveAttribute('fetchpriority', 'high')
  fireEvent.error(view.container.querySelector('img'))
  expect(screen.getByRole('img', { name:'研究报道：封面暂不可用' })).toBeInTheDocument()
  expect(view.container.querySelector('img')).toBeNull()
  view.rerender(<SectionCover src="https://img.563118077.xyz/two.jpg" title="产品报道" />)
  expect(view.container.querySelector('img')).toHaveAttribute('src', 'https://img.563118077.xyz/two.jpg')
  expect(view.container.querySelector('img')).toHaveAttribute('loading', 'lazy')
  view.rerender(<SectionCover title="文字报道" />)
  expect(screen.getByRole('img', { name:'文字报道：暂无封面' })).toBeInTheDocument()
})
