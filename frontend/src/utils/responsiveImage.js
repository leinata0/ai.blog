import manifest from '../data/image-variants.json'
import { proxyImageUrl } from './proxyImage'
import { PERFORMANCE_TRIAL_ENABLED } from './performanceTrial'

const CANONICAL_ORIGIN = 'https://www.563118077.xyz'

function knownImage(source) {
  if (typeof source !== 'string' || !source.trim()) return null
  try {
    // Relative public artwork has the same identity on previews and production.
    const key = new URL(source.trim(), CANONICAL_ORIGIN).href
    const image = manifest.images[key]
    return image?.variants?.length ? image : null
  } catch { return null }
}

/** Only use derivatives explicitly recorded after successful offline encoding. */
export function responsiveImageAttrs(source, { sizes = '100vw', disabled = false, targetWidth = 1600 } = {}) {
  const original = proxyImageUrl(source)
  const image = PERFORMANCE_TRIAL_ENABLED && !disabled ? knownImage(source) : null
  if (!original || !image) return { src: original }
  const variants = image.variants
  const selected = variants.find((variant) => variant.width >= targetWidth) || variants.at(-1)
  return {
    src: selected.url,
    srcSet: variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '),
    sizes,
    width: image.width,
    height: image.height,
  }
}

/** Texture/CSS consumers do not support srcset; use a bounded recorded variant. */
export function optimizedImageUrl(source, targetWidth = 1600) {
  return responsiveImageAttrs(source, { targetWidth }).src
}
