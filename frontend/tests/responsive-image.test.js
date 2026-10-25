import { afterEach, describe, expect, it, vi } from 'vitest'
import manifest from '../src/data/image-variants.json'
import { optimizedImageUrl, responsiveImageAttrs } from '../src/utils/responsiveImage'

const [source, image] = Object.entries(manifest.images)[0]
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('recorded responsive images', () => {
  it('uses only known immutable variants and explicit viewport sizing', () => {
    const attrs = responsiveImageAttrs(source, { sizes: '(max-width: 700px) 90vw, 30vw', targetWidth: 900 })
    expect(attrs.src).toBe(image.variants.find((variant) => variant.width >= 900).url)
    expect(attrs.srcSet).toBe(image.variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '))
    expect(attrs.sizes).toBe('(max-width: 700px) 90vw, 30vw')
    expect(attrs.width).toBe(image.width)
    expect(attrs.height).toBe(image.height)
  })

  it('leaves unknown future images untouched and never guesses a derivative path', () => {
    expect(responsiveImageAttrs('https://img.563118077.xyz/not-in-the-manifest.png')).toEqual({ src: 'https://img.563118077.xyz/not-in-the-manifest.png' })
    expect(responsiveImageAttrs('')).toEqual({ src: '' })
    expect(responsiveImageAttrs('javascript:alert(1)')).toEqual({ src: '' })
  })

  it('recognizes original local artwork independent of the preview hostname', () => {
    expect(optimizedImageUrl('/images/renaissance-edition/figures.png')).toMatch(/^\/performance-images\/[^/]+\.webp$/)
    expect(responsiveImageAttrs(source, { disabled: true })).toEqual({ src: source })
  })

  it('returns original URLs without srcset when the trial switch is disabled', async () => {
    vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
    const disabled = await import('../src/utils/responsiveImage')
    expect(disabled.responsiveImageAttrs(source)).toEqual({ src: source })
    expect(disabled.optimizedImageUrl('/images/renaissance-edition/figures.png')).toBe('/images/renaissance-edition/figures.png')
  })
})
