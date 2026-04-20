const PROXY_BASE = import.meta.env.VITE_IMAGE_PROXY_BASE || '/proxy-image'
const API_BASE = import.meta.env.VITE_API_BASE || ''
const DEFAULT_DIRECT_BASES = ['https://img.563118077.xyz']
const DIRECT_BASES = Array.from(new Set([
  ...DEFAULT_DIRECT_BASES,
  ...(import.meta.env.VITE_IMAGE_DIRECT_BASES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
]))

export function proxyImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.startsWith('/')) return url
  if (API_BASE && url.startsWith(API_BASE)) return url
  if (DIRECT_BASES.some((base) => url.startsWith(base))) return url
  return `${PROXY_BASE}?url=${encodeURIComponent(url)}`
}
