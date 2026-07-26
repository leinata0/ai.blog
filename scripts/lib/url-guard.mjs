import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Server-side fetches of third-party URLs (RSS <link>/<guid>, image candidates
// parsed out of source pages, URLs pulled from already-published article bodies)
// are an SSRF vector: the worker runs next to internal services and, by default,
// BLOG_API_BASE points at localhost. A malicious or compromised feed entry could
// point fetches at cloud metadata (169.254.169.254), loopback, or other internal
// hosts. assertPublicHttpUrl validates the scheme and rejects any host that is not
// a public name, so callers can fail closed before issuing the request.
//
// The address tables below mirror backend/app/url_safety.py:is_blocked_ip, which
// is the union of Python `ipaddress` is_private / is_loopback / is_link_local /
// is_multicast / is_unspecified / is_reserved. Hand-rolled octet branches drifted
// from that set before (benchmark, TEST-NET, NAT64, IPv6 multicast were all
// treated as public here while the backend rejected them), so keep the two lists
// in sync and extend scripts/tests/url-guard.test.mjs when either side changes.

// Hostnames that must never be fetched server-side, even before DNS resolution.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
])

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local']

const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8', // "this" network / unspecified
  '10.0.0.0/8', // RFC1918
  '100.64.0.0/10', // carrier-grade NAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local / cloud metadata
  '172.16.0.0/12', // RFC1918
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.168.0.0/16', // RFC1918
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, incl. 255.255.255.255
]

const BLOCKED_IPV6_CIDRS = [
  '::/128', // unspecified
  '::1/128', // loopback
  '64:ff9b::/96', // NAT64 well-known prefix
  '64:ff9b:1::/48', // NAT64 local-use prefix
  '100::/64', // discard-only
  '2001::/23', // IETF protocol assignments (incl. Teredo)
  '2001:db8::/32', // documentation
  'fc00::/7', // unique-local
  'fe80::/10', // link-local
  'ff00::/8', // multicast
]

function parseIPv4(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return null
  const octets = match.slice(1).map((value) => Number(value))
  // Malformed dotted quads are never safe to hand to a resolver.
  if (octets.some((value) => value > 255)) return { value: 0, malformed: true }
  const value = (octets[0] * 16777216) + (octets[1] * 65536) + (octets[2] * 256) + octets[3]
  return { value, malformed: false }
}

function parseIPv6(host) {
  let value = String(host || '').toLowerCase()
  if (!value.includes(':')) return null

  // ::ffff:127.0.0.1 style trailing dotted quads become two hex groups.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
  if (dotted) {
    const embedded = parseIPv4(dotted[1])
    if (!embedded || embedded.malformed) return null
    const high = ((embedded.value >>> 16) & 0xffff).toString(16)
    const low = (embedded.value & 0xffff).toString(16)
    value = `${value.slice(0, dotted.index)}${high}:${low}`
  }

  if ((value.match(/::/g) || []).length > 1) return null

  let head = []
  let tail = []
  if (value.includes('::')) {
    const [left, right] = value.split('::')
    head = left ? left.split(':') : []
    tail = right ? right.split(':') : []
    if (head.length + tail.length > 7) return null
  } else {
    head = value.split(':')
    if (head.length !== 8) return null
  }

  const groups = [
    ...head,
    ...new Array(8 - head.length - tail.length).fill('0'),
    ...tail,
  ].map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN))

  if (groups.length !== 8 || groups.some((group) => !Number.isFinite(group))) return null
  return groups
}

function compileIPv4Cidr(cidr) {
  const [network, prefix] = cidr.split('/')
  const prefixLength = Number(prefix)
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0
  return { network: parseIPv4(network).value >>> 0, mask }
}

function compileIPv6Cidr(cidr) {
  const [network, prefix] = cidr.split('/')
  return { network: parseIPv6(network), prefixLength: Number(prefix) }
}

const BLOCKED_IPV4_NETWORKS = BLOCKED_IPV4_CIDRS.map(compileIPv4Cidr)
const BLOCKED_IPV6_NETWORKS = BLOCKED_IPV6_CIDRS.map(compileIPv6Cidr)

function matchesIPv6Cidr(groups, { network, prefixLength }) {
  let remaining = prefixLength
  for (let index = 0; index < 8 && remaining > 0; index += 1) {
    const bits = Math.min(16, remaining)
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff
    if ((groups[index] & mask) !== (network[index] & mask)) return false
    remaining -= bits
  }
  return true
}

// Returns true/false for IPv4 literals, null when the host is not an IPv4 literal.
function classifyIPv4(host) {
  const parsed = parseIPv4(host)
  if (!parsed) return null
  if (parsed.malformed) return true
  return BLOCKED_IPV4_NETWORKS.some(({ network, mask }) => ((parsed.value & mask) >>> 0) === network)
}

// Returns true/false for IPv6 literals, null when the host is not an IPv6 literal.
function classifyIPv6(host) {
  const groups = parseIPv6(host)
  if (!groups) return null
  if (BLOCKED_IPV6_NETWORKS.some((cidr) => matchesIPv6Cidr(groups, cidr))) return true
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses reach
  // the embedded IPv4 destination, so they inherit the IPv4 verdict.
  const embedsIPv4 = groups.slice(0, 5).every((group) => group === 0)
    && (groups[5] === 0xffff || groups[5] === 0)
  if (embedsIPv4) {
    const value = (groups[6] * 65536) + groups[7]
    const dotted = `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`
    return classifyIPv4(dotted) === true
  }
  return false
}

// Lowercases, unwraps IPv6 brackets/zone ids and strips the DNS root dot so
// "localhost." and "metadata.google.internal." cannot slip past the blocklist.
export function normalizeHostname(rawHost) {
  const value = String(rawHost || '').trim()
  if (!value) return ''
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split('%')[0]
    .toLowerCase()
    .replace(/\.+$/, '')
}

function blockedHostnameReason(host) {
  if (!host) return 'empty host'
  if (BLOCKED_HOSTNAMES.has(host)) return `blocked host ${host}`
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return `internal host ${host}`
  const ipv4 = classifyIPv4(host)
  if (ipv4 === true) return `private or link-local address ${host}`
  if (ipv4 === false) return ''
  const ipv6 = classifyIPv6(host)
  if (ipv6 === true) return `private or link-local address ${host}`
  return ''
}

// Returns true when the hostname is safe to fetch (a public name or public IP).
export function isPublicHttpHostname(hostname) {
  return blockedHostnameReason(normalizeHostname(hostname)) === ''
}

// Validates a third-party URL before a server-side fetch. Returns the parsed URL
// on success; throws a descriptive Error if the scheme is not http(s), the URL
// carries credentials, or the host is not a public address. Callers should treat
// a throw as "skip this URL".
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
  // Credentials create confusing Host/redirect semantics and would leak secrets
  // to the upstream. Reject here so every caller fails closed, not just the ones
  // that remember to re-check before issuing the request.
  if (parsed.username || parsed.password) {
    throw new Error('Unsafe URL: credentials are not allowed')
  }
  const host = normalizeHostname(parsed.hostname)
  const reason = blockedHostnameReason(host)
  if (reason) throw new Error(`Unsafe URL: ${reason}`)
  return parsed
}

export async function assertPublicResolvedHttpUrl(rawUrl, {
  lookupImpl = dnsLookup,
} = {}) {
  return (await resolvePublicHttpUrl(rawUrl, { lookupImpl })).url
}

// Resolves once and returns the exact vetted addresses so callers can pin the
// subsequent socket connection instead of allowing the HTTP client to perform
// a second, potentially rebound DNS lookup.
export async function resolvePublicHttpUrl(rawUrl, {
  lookupImpl = dnsLookup,
} = {}) {
  const parsed = assertPublicHttpUrl(rawUrl)
  const host = normalizeHostname(parsed.hostname)
  if (isIP(host)) {
    return {
      url: parsed,
      addresses: [{ address: host, family: isIP(host) }],
    }
  }

  const records = await lookupImpl(host, { all: true, verbatim: true })
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Unsafe URL: hostname ${host} did not resolve`)
  }
  for (const record of records) {
    if (!isPublicHttpHostname(record?.address)) {
      throw new Error(`Unsafe URL: hostname ${host} resolves to non-public address ${record?.address || ''}`)
    }
  }
  return {
    url: parsed,
    addresses: records.map((record) => ({
      address: record.address,
      family: Number(record.family) || isIP(record.address),
    })),
  }
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
