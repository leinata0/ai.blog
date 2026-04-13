const PROXY_BASE = import.meta.env.VITE_IMAGE_PROXY_BASE || 'https://api.563118077.xyz/proxy-image'
const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.563118077.xyz'
const DIRECT_BASES = (import.meta.env.VITE_IMAGE_DIRECT_BASES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

export function proxyImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.startsWith('/')) return `${API_BASE}${url}`
  if (url.startsWith(API_BASE)) return url
  if (DIRECT_BASES.some((base) => url.startsWith(base))) return url
  return `${PROXY_BASE}?url=${encodeURIComponent(url)}`
}
