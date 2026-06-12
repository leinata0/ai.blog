// Server-side fetches of third-party URLs (RSS <link>/<guid>, image candidates
// parsed out of source pages, URLs pulled from already-published article bodies)
// are an SSRF vector: the worker runs next to internal services and, by default,
// BLOG_API_BASE points at localhost. A malicious or compromised feed entry could
// point fetches at cloud metadata (169.254.169.254), loopback, or other internal
// hosts. assertPublicHttpUrl validates the scheme and rejects any host that is not
// a public name, so callers can fail closed before issuing the request.

// Hostnames that must never be fetched server-side, even before DNS resolution.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
])

function isPrivateIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const octets = match.slice(1).map((value) => Number(value))
  if (octets.some((value) => value > 255)) return true // malformed → treat as unsafe
  const [a, b] = octets
  if (a === 10) return true
  if (a === 127) return true // loopback
  if (a === 0) return true // "this" network
  if (a === 169 && b === 254) return true // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast / reserved
  return false
}

function normalizeIPv6(host) {
  // URL hosts wrap IPv6 in brackets; strip them and any zone id.
  return host.replace(/^\[/, '').replace(/\]$/, '').split('%')[0].toLowerCase()
}

function isPrivateIPv6(host) {
  const value = normalizeIPv6(host)
  if (value === '::1' || value === '::') return true // loopback / unspecified
  if (value.startsWith('fe80')) return true // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true // unique-local
  // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded IPv4.
  const mappedDotted = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(value)
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1])
  // The URL parser normalizes ::ffff:127.0.0.1 to its hex form (::ffff:7f00:1),
  // so re-decode the trailing hex groups back into IPv4 and re-check.
  const mappedHex = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(value)
  if (mappedHex) {
    const high = parseInt(mappedHex[1], 16)
    const low = parseInt(mappedHex[2], 16)
    const dotted = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
    return isPrivateIPv4(dotted)
  }
  return false
}

// Returns true when the hostname is safe to fetch (a public name or public IP).
export function isPublicHttpHostname(hostname) {
  const raw = String(hostname || '').trim()
  if (!raw) return false
  const isIPv6 = raw.includes(':') || raw.startsWith('[')
  const host = isIPv6 ? normalizeIPv6(raw) : raw.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) return false
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false
  if (isIPv6) return !isPrivateIPv6(raw)
  if (isPrivateIPv4(host)) return false
  return true
}

// Validates a third-party URL before a server-side fetch. Returns the parsed URL
// on success; throws a descriptive Error if the scheme is not http(s) or the host
// resolves to a non-public address. Callers should treat a throw as "skip this URL".
export function assertPublicHttpUrl(rawUrl) {
  let parsed
  try {
    parsed = new URL(String(rawUrl || ''))
  } catch {
    throw new Error(`Unsafe URL: not a valid absolute URL (${String(rawUrl || '').slice(0, 80)})`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsafe URL: scheme ${parsed.protocol} is not http(s)`)
  }
  const host = parsed.hostname.includes(':') || parsed.hostname.startsWith('[')
    ? normalizeIPv6(parsed.hostname)
    : parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Unsafe URL: blocked host ${host}`)
  }
  if (host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`Unsafe URL: internal host ${host}`)
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(parsed.hostname)) {
    throw new Error(`Unsafe URL: private or link-local address ${host}`)
  }
  return parsed
}

// Convenience boolean wrapper for callers that prefer filtering to try/catch.
export function isPublicHttpUrl(rawUrl) {
  try {
    assertPublicHttpUrl(rawUrl)
    return true
  } catch {
    return false
  }
}
