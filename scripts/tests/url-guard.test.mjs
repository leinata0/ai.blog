import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertPublicHttpUrl,
  assertPublicResolvedHttpUrl,
  isPublicHttpUrl,
  isPublicHttpHostname,
  normalizeHostname,
} from '../lib/url-guard.mjs'

// Single source of truth for the JS-side SSRF verdicts. The JS guard and the
// backend guard (backend/app/url_safety.py::is_public_http_url with
// resolve_dns=False) previously disagreed on eight address classes — benchmark,
// IETF protocol assignments, TEST-NET-1/2/3, IPv6 multicast, NAT64 and
// trailing-dot hostnames were all fetchable from Node while the backend refused
// them. Add a row here (and to the backend's table) whenever either side moves.
export const SSRF_URL_VECTORS = [
  // --- ordinary public destinations ---
  { url: 'https://openai.com/blog/post', expected: true, label: 'public https host' },
  { url: 'http://techcrunch.com/2026/06/article', expected: true, label: 'public http host' },
  { url: 'https://example.co.uk/path?q=1', expected: true, label: 'public host with query' },
  { url: 'http://8.8.8.8/', expected: true, label: 'public literal IPv4' },
  { url: 'http://172.32.0.1/', expected: true, label: 'just outside RFC1918 172.16/12' },
  { url: 'http://[2606:2800:220:1:248:1893:25c8:1946]/', expected: true, label: 'public literal IPv6' },

  // --- schemes ---
  { url: 'file:///etc/passwd', expected: false, label: 'file scheme' },
  { url: 'ftp://example.com/x', expected: false, label: 'ftp scheme' },
  { url: 'gopher://example.com', expected: false, label: 'gopher scheme' },
  { url: 'data:text/html,<script>', expected: false, label: 'data scheme' },

  // --- loopback / unspecified ---
  { url: 'http://127.0.0.1/', expected: false, label: 'IPv4 loopback' },
  { url: 'http://127.1.2.3/', expected: false, label: 'IPv4 loopback range' },
  { url: 'http://0.0.0.0/', expected: false, label: 'IPv4 unspecified' },
  { url: 'http://[::1]/', expected: false, label: 'IPv6 loopback' },
  { url: 'http://[::]/', expected: false, label: 'IPv6 unspecified' },
  { url: 'http://[::ffff:127.0.0.1]/', expected: false, label: 'IPv4-mapped loopback' },
  { url: 'http://localhost:8000/api', expected: false, label: 'localhost' },
  { url: 'http://localhost./', expected: false, label: 'localhost with DNS root dot' },

  // --- RFC1918 / CGNAT ---
  { url: 'http://10.0.0.5/', expected: false, label: 'RFC1918 10/8' },
  { url: 'http://172.16.0.1/', expected: false, label: 'RFC1918 172.16/12 start' },
  { url: 'http://172.31.255.255/', expected: false, label: 'RFC1918 172.16/12 end' },
  { url: 'http://192.168.1.1/', expected: false, label: 'RFC1918 192.168/16' },
  { url: 'http://100.64.0.1/', expected: false, label: 'carrier-grade NAT 100.64/10' },

  // --- link-local / metadata ---
  { url: 'http://169.254.169.254/latest/meta-data/', expected: false, label: 'cloud metadata' },
  { url: 'http://metadata.google.internal/', expected: false, label: 'GCE metadata name' },
  { url: 'http://metadata.google.internal./', expected: false, label: 'GCE metadata name with root dot' },
  { url: 'http://[fe80::1]/', expected: false, label: 'IPv6 link-local' },
  { url: 'http://[fe90::1]/', expected: false, label: 'IPv6 link-local upper half' },
  { url: 'http://[febf::1]/', expected: false, label: 'IPv6 link-local end' },
  { url: 'http://[fd00::1]/', expected: false, label: 'IPv6 unique-local' },

  // --- reserved / special-purpose ranges the octet branches used to allow ---
  { url: 'http://198.18.0.1/', expected: false, label: 'benchmarking 198.18/15' },
  { url: 'http://198.19.255.1/', expected: false, label: 'benchmarking 198.18/15 end' },
  { url: 'http://192.0.0.8/', expected: false, label: 'IETF protocol assignments 192.0.0/24' },
  { url: 'http://192.0.2.5/', expected: false, label: 'TEST-NET-1' },
  { url: 'http://198.51.100.7/', expected: false, label: 'TEST-NET-2' },
  { url: 'http://203.0.113.9/', expected: false, label: 'TEST-NET-3' },
  { url: 'http://224.0.0.1/', expected: false, label: 'IPv4 multicast' },
  { url: 'http://255.255.255.255/', expected: false, label: 'IPv4 broadcast / reserved' },
  { url: 'http://[ff02::1]/', expected: false, label: 'IPv6 multicast all-nodes' },
  { url: 'http://[ff00::2]/', expected: false, label: 'IPv6 multicast base' },
  { url: 'http://[64:ff9b::7f00:1]/', expected: false, label: 'NAT64 to 127.0.0.1' },
  { url: 'http://[2001:db8::1]/', expected: false, label: 'IPv6 documentation range' },

  // --- internal name suffixes ---
  { url: 'http://service.internal/', expected: false, label: '.internal suffix' },
  { url: 'http://db.local/', expected: false, label: '.local suffix' },
  // Stricter than the backend on purpose: these single-label / *.localhost names
  // only resolve inside a container network, never on the public internet.
  { url: 'http://metadata/', expected: false, label: 'bare metadata hostname (stricter than backend)' },
  { url: 'http://api.localhost/', expected: false, label: '*.localhost (stricter than backend)' },

  // --- credentials ---
  { url: 'https://user:pass@example.com/image.png', expected: false, label: 'URL with credentials' },
  { url: 'https://user@example.com/image.png', expected: false, label: 'URL with username only' },

  // --- malformed ---
  { url: '', expected: false, label: 'empty string' },
  { url: null, expected: false, label: 'null' },
  { url: 'not a url', expected: false, label: 'not a URL' },
  { url: '//example.com/x', expected: false, label: 'protocol-relative' },
]

test('isPublicHttpUrl matches the shared SSRF vector table', () => {
  for (const vector of SSRF_URL_VECTORS) {
    assert.equal(
      isPublicHttpUrl(vector.url),
      vector.expected,
      `${vector.label}: ${String(vector.url)} should be ${vector.expected ? 'public' : 'blocked'}`,
    )
  }
})

test('assertPublicHttpUrl throws for every blocked vector and parses the public ones', () => {
  for (const vector of SSRF_URL_VECTORS) {
    if (vector.expected) {
      assert.equal(assertPublicHttpUrl(vector.url).protocol.startsWith('http'), true, vector.label)
    } else {
      assert.throws(() => assertPublicHttpUrl(vector.url), /Unsafe URL/, vector.label)
    }
  }
})

test('assertPublicHttpUrl rejects credentials with a dedicated message', () => {
  assert.throws(
    () => assertPublicHttpUrl('https://admin:secret@cdn.example.com/a.png'),
    /credentials are not allowed/,
  )
})

test('assertPublicHttpUrl returns the parsed URL on success and keeps legacy messages', () => {
  const parsed = assertPublicHttpUrl('https://openai.com/blog')
  assert.equal(parsed.hostname, 'openai.com')
  assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/'), /private or link-local/)
  assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'), /not http/)
})

test('normalizeHostname lowercases, unwraps IPv6 and strips the DNS root dot', () => {
  assert.equal(normalizeHostname('LOCALHOST.'), 'localhost')
  assert.equal(normalizeHostname('[fe80::1%eth0]'), 'fe80::1')
  assert.equal(normalizeHostname('Example.COM..'), 'example.com')
  assert.equal(normalizeHostname(''), '')
})

test('isPublicHttpHostname classifies bare hostnames and resolved addresses', () => {
  assert.equal(isPublicHttpHostname('openai.com'), true)
  assert.equal(isPublicHttpHostname('93.184.216.34'), true)
  assert.equal(isPublicHttpHostname('127.0.0.1'), false)
  assert.equal(isPublicHttpHostname('10.1.2.3'), false)
  assert.equal(isPublicHttpHostname('198.18.0.1'), false)
  assert.equal(isPublicHttpHostname('ff02::1'), false)
  assert.equal(isPublicHttpHostname('localhost'), false)
  assert.equal(isPublicHttpHostname(''), false)
})

test('assertPublicResolvedHttpUrl rejects public-looking DNS names that resolve privately', async () => {
  const lookupImpl = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]

  await assert.rejects(
    assertPublicResolvedHttpUrl('https://attacker.example/image.png', { lookupImpl }),
    /resolves to non-public address 127\.0\.0\.1/,
  )
})

test('assertPublicResolvedHttpUrl rejects DNS answers inside newly covered ranges', async () => {
  const lookupImpl = async () => [{ address: '198.18.0.7', family: 4 }]

  await assert.rejects(
    assertPublicResolvedHttpUrl('https://benchmark.example/image.png', { lookupImpl }),
    /non-public address 198\.18\.0\.7/,
  )
})

test('assertPublicResolvedHttpUrl accepts hostnames only when every resolved address is public', async () => {
  const lookupImpl = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]

  const parsed = await assertPublicResolvedHttpUrl('https://example.com/image.png', { lookupImpl })
  assert.equal(parsed.hostname, 'example.com')
})

test('assertPublicResolvedHttpUrl normalizes the trailing dot before resolving', async () => {
  const looked = []
  const lookupImpl = async (host) => {
    looked.push(host)
    return [{ address: '93.184.216.34', family: 4 }]
  }

  await assertPublicResolvedHttpUrl('https://example.com./image.png', { lookupImpl })
  assert.deepEqual(looked, ['example.com'])
})
