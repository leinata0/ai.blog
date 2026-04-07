const PROXY_BASE = import.meta.env.VITE_IMAGE_PROXY_BASE || 'https://api.563118077.xyz/proxy-image'

export function proxyImageUrl(url) {
  if (!url) return ''
  if (url.startsWith('data:') || url.startsWith('blob:')) return url
  if (url.startsWith('/')) return url
  return `${PROXY_BASE}?url=${encodeURIComponent(url)}`
}
