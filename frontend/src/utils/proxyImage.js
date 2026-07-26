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

// Prerender/SSR has no location; fall back to the canonical host so relative paths still resolve.
const FALLBACK_ORIGIN = 'https://www.563118077.xyz'

function currentOrigin() {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
  return FALLBACK_ORIGIN
}

function parseUrl(value, base) {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

/** Normalize an allow-list entry to { origin, path } so matching is never a raw prefix test. */
function toAllowedBase(value) {
  const parsed = parseUrl(value, currentOrigin())
  if (!parsed) return null
  return { origin: parsed.origin, path: parsed.pathname.replace(/\/+$/, '') }
}

/**
 * origin 必须完全相等，pathname 必须是"整段前缀"。
 * 纯字符串 startsWith 会让 https://img.563118077.xyz.attacker.com 通过白名单，
 * 从而绕过后端 /proxy-image 的 SSRF / 内容类型 / 体积校验。
 */
function isWithinBase(target, base) {
  if (!base || !target) return false
  if (target.origin !== base.origin) return false
  if (!base.path) return true
  return target.pathname === base.path || target.pathname.startsWith(`${base.path}/`)
}

const API_BASE_INFO = API_BASE ? toAllowedBase(API_BASE) : null
const DIRECT_BASE_INFOS = DIRECT_BASES.map((base) => toAllowedBase(base)).filter(Boolean)

export function proxyImageUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : ''
  if (!raw) return ''
  if (/^(?:data|blob):/i.test(raw)) return raw

  const origin = currentOrigin()
  const target = parseUrl(raw, origin)
  // Unparseable or non-http(s) (javascript:, file:, …) must never reach an <img src>.
  if (!target || !/^https?:$/i.test(target.protocol)) return ''

  // "//evil.com/x.png" 满足旧代码的 startsWith('/') 判断却是跨站直连，
  // 所以协议相对 URL 一律先解析成绝对地址再判归属，绝不原样返回。
  const passthrough = raw.startsWith('//') ? target.href : raw

  if (target.origin === origin) return passthrough
  if (isWithinBase(target, API_BASE_INFO)) return passthrough
  if (DIRECT_BASE_INFOS.some((base) => isWithinBase(target, base))) return passthrough

  return `${PROXY_BASE}?url=${encodeURIComponent(target.href)}`
}
