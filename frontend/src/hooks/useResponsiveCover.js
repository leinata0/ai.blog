import { useState } from 'react'
import { proxyImageUrl } from '../utils/proxyImage'
import { responsiveImageAttrs } from '../utils/responsiveImage'

export default function useResponsiveCover(source, options) {
  const original = proxyImageUrl(source)
  const [failure, setFailure] = useState(null)
  const current = failure?.source === original ? failure : null
  const image = responsiveImageAttrs(source, { ...options, disabled: Boolean(current?.variant) })
  return {
    unavailable: !original || Boolean(current?.original),
    imageProps: {
      ...image,
      onError: () => setFailure({ source: original, variant: Boolean(image.srcSet) || Boolean(current?.variant), original: !image.srcSet }),
    },
  }
}
