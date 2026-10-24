import { useState } from 'react'
import { proxyImageUrl } from '../../../utils/proxyImage'

/** A missing cover remains a text edition instead of borrowing unrelated art. */
export default function SectionCover({ src, title, eager = false }) {
  const url = proxyImageUrl(src)
  const [failed, setFailed] = useState('')
  return url && failed !== url ? <img src={url} alt="" width="1672" height="941" loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : undefined} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(url)} /> : <div className="cinema-cover-fallback" role="img" aria-label={`${title}：${url ? '封面暂不可用' : '暂无封面'}`}><span>AI OBSERVER / TEXT EDITION</span><strong>{title}</strong><small>{url ? '封面暂不可用' : '暂无封面'}</small></div>
}
