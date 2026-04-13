const PROXY_BASE = import.meta.env.VITE_IMAGE_PROXY_BASE || '/proxy-image'
const API_BASE = import.meta.env.VITE_API_BASE || ''
const DIRECT_BASES = (import.meta.env.VITE_IMAGE_DIRECT_BASES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

export function proxyImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.startsWith('/')) return url
  if (API_BASE && url.startsWith(API_BASE)) return url
  if (DIRECT_BASES.some((base) => url.startsWith(base))) return url
  return `${PROXY_BASE}?url=${encodeURIComponent(url)}`
}
