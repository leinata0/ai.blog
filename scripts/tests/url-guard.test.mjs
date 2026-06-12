import assert from 'node:assert/strict'
import test from 'node:test'

import { assertPublicHttpUrl, isPublicHttpUrl, isPublicHttpHostname } from '../lib/url-guard.mjs'

test('isPublicHttpUrl accepts ordinary public http(s) URLs', () => {
  assert.equal(isPublicHttpUrl('https://openai.com/blog/post'), true)
  assert.equal(isPublicHttpUrl('http://techcrunch.com/2026/06/article'), true)
  assert.equal(isPublicHttpUrl('https://example.co.uk/path?q=1'), true)
})

test('isPublicHttpUrl rejects non-http schemes', () => {
  assert.equal(isPublicHttpUrl('file:///etc/passwd'), false)
  assert.equal(isPublicHttpUrl('ftp://example.com/x'), false)
  assert.equal(isPublicHttpUrl('gopher://example.com'), false)
  assert.equal(isPublicHttpUrl('data:text/html,<script>'), false)
})

test('isPublicHttpUrl rejects loopback and localhost', () => {
  assert.equal(isPublicHttpUrl('http://127.0.0.1/'), false)
  assert.equal(isPublicHttpUrl('http://localhost:8000/api'), false)
  assert.equal(isPublicHttpUrl('http://[::1]/'), false)
  assert.equal(isPublicHttpUrl('http://0.0.0.0/'), false)
})

test('isPublicHttpUrl rejects cloud metadata and link-local addresses', () => {
  assert.equal(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/'), false)
  assert.equal(isPublicHttpUrl('http://metadata.google.internal/'), false)
  assert.equal(isPublicHttpUrl('http://[fe80::1]/'), false)
})

test('isPublicHttpUrl rejects RFC1918 private ranges', () => {
  assert.equal(isPublicHttpUrl('http://10.0.0.5/'), false)
  assert.equal(isPublicHttpUrl('http://172.16.0.1/'), false)
  assert.equal(isPublicHttpUrl('http://172.31.255.255/'), false)
  assert.equal(isPublicHttpUrl('http://192.168.1.1/'), false)
  // 172.32 is outside the private block and should be allowed.
  assert.equal(isPublicHttpUrl('http://172.32.0.1/'), true)
})

test('isPublicHttpUrl rejects internal TLDs and IPv4-mapped IPv6 loopback', () => {
  assert.equal(isPublicHttpUrl('http://service.internal/'), false)
  assert.equal(isPublicHttpUrl('http://db.local/'), false)
  assert.equal(isPublicHttpUrl('http://api.localhost/'), false)
  assert.equal(isPublicHttpUrl('http://[::ffff:127.0.0.1]/'), false)
})

test('isPublicHttpUrl rejects malformed input', () => {
  assert.equal(isPublicHttpUrl(''), false)
  assert.equal(isPublicHttpUrl(null), false)
  assert.equal(isPublicHttpUrl('not a url'), false)
  assert.equal(isPublicHttpUrl('//example.com/x'), false)
})

test('assertPublicHttpUrl returns the parsed URL on success and throws on rejection', () => {
  const parsed = assertPublicHttpUrl('https://openai.com/blog')
  assert.equal(parsed.hostname, 'openai.com')
  assert.throws(() => assertPublicHttpUrl('http://169.254.169.254/'), /private or link-local/)
  assert.throws(() => assertPublicHttpUrl('file:///etc/passwd'), /not http/)
})

test('isPublicHttpHostname classifies bare hostnames', () => {
  assert.equal(isPublicHttpHostname('openai.com'), true)
  assert.equal(isPublicHttpHostname('127.0.0.1'), false)
  assert.equal(isPublicHttpHostname('10.1.2.3'), false)
  assert.equal(isPublicHttpHostname('localhost'), false)
})
