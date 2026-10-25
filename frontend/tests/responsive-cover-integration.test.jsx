import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import manifest from '../src/data/image-variants.json'
import { NewsCover } from '../src/components/news/NewsArticle'
import CoverCard from '../src/components/CoverCard'

const source = Object.keys(manifest.images).find(url => url.startsWith('https://img.'))
afterEach(cleanup)

it('retains the same article destination while a derivative failure retries the original cover', () => {
  const view = render(<MemoryRouter><NewsCover post={{slug:'own-report',title:'本篇报道',cover_image:source}} priority fallback={<span>无图报道</span>} /></MemoryRouter>)
  expect(view.container.querySelector('img')).toHaveAttribute('srcset')
  expect(view.container.querySelector('img').getAttribute('src')).toMatch(/^\/performance-images\//)
  expect(screen.getByRole('link', {name:'阅读：本篇报道'})).toHaveAttribute('href','/posts/own-report')
  fireEvent.error(view.container.querySelector('img'))
  expect(view.container.querySelector('img')).toHaveAttribute('src',source)
  expect(view.container.querySelector('img')).not.toHaveAttribute('srcset')
  fireEvent.error(view.container.querySelector('img'))
  expect(screen.getByText('无图报道')).toBeInTheDocument()
  view.rerender(<MemoryRouter><NewsCover post={{slug:'next',title:'下一篇',cover_image:'https://img.563118077.xyz/new-unmapped.jpg'}} /></MemoryRouter>)
  expect(view.container.querySelector('img')).toHaveAttribute('src','https://img.563118077.xyz/new-unmapped.jpg')
  expect(screen.getByRole('link', {name:'阅读：下一篇'})).toHaveAttribute('href','/posts/next')
})

it('preserves paper card cover and navigation when optimized assets cannot load', () => {
  const view = render(<MemoryRouter><CoverCard title="原有卡片" to="/topics/own" image={source} imageAlt="本主题封面" /></MemoryRouter>)
  fireEvent.error(view.container.querySelector('img'))
  expect(view.container.querySelector('img')).toHaveAttribute('src',source)
  fireEvent.error(view.container.querySelector('img'))
  expect(view.container.querySelector('.cover-card__media--placeholder')).toBeInTheDocument()
  expect(screen.getByRole('link', {name:/原有卡片/})).toHaveAttribute('href','/topics/own')
})
