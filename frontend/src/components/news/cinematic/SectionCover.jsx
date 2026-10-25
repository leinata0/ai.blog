import { useState } from 'react'
import { proxyImageUrl } from '../../../utils/proxyImage'
import { responsiveImageAttrs } from '../../../utils/responsiveImage'

/** A missing cover remains a text edition instead of borrowing unrelated art. */
export default function SectionCover({ src, title, eager = false, sizes = '100vw' }) {
  const url = proxyImageUrl(src)
  const [failed, setFailed] = useState('')
  const [variantFailed, setVariantFailed] = useState('')
  const image = responsiveImageAttrs(src, { sizes, disabled: variantFailed === url })
  const handleError = () => {
    if (image.srcSet) setVariantFailed(url)
    else setFailed(url)
  }
  return url && failed !== url ? <img width="1672" height="941" {...image} alt="" loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : undefined} decoding="async" referrerPolicy="no-referrer" onError={handleError} /> : <div className="cinema-cover-fallback" role="img" aria-label={`${title}：${url ? '封面暂不可用' : '暂无封面'}`}><span>AI OBSERVER / TEXT EDITION</span><strong>{title}</strong><small>{url ? '封面暂不可用' : '暂无封面'}</small></div>
}
