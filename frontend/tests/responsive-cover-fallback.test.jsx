import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SectionCover from '../src/components/news/cinematic/SectionCover'
import { ArticleCover } from '../src/components/news/daily/DailyEdition'
import manifest from '../src/data/image-variants.json'

const source = Object.keys(manifest.images)[0]
for (const variant of ['section', 'daily']) describe(`${variant} cover recovery`, () => {
  const cover = (src) => variant === 'section'
    ? <SectionCover src={src} title="真实文章封面" sizes="40vw" eager />
    : <ArticleCover post={{ title: '真实文章封面', cover_image: src }} sizes="40vw" eager />

  it('retries the original after derivative failure, then displays the text fallback', () => {
    const { container } = render(cover(source))
    const image = container.querySelector('img')
    expect(image.getAttribute('src')).toMatch(/^\/performance-images\//)
    expect(image).toHaveAttribute('sizes', '40vw')
    expect(image).toHaveAttribute('loading', 'eager')
    fireEvent.error(image)
    expect(image).toHaveAttribute('src', source)
    expect(image).not.toHaveAttribute('srcset')
    fireEvent.error(image)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: /真实文章封面.*暂不可用/ })).toBeInTheDocument()
  })

  it('a failure for one article does not hide the next article', () => {
    const { container, rerender } = render(cover('https://img.563118077.xyz/unavailable.png'))
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    rerender(cover(source))
    expect(container.querySelector('img').getAttribute('src')).toMatch(/^\/performance-images\//)
  })
})
