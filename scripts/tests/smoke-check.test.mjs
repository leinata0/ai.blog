import assert from 'node:assert/strict'
import test from 'node:test'

import { assertSafeAdminTarget, main, resolveAllowedAdminHosts } from '../smoke-check.mjs'

// `smoke-check.mjs` POSTs ADMIN_USERNAME/ADMIN_PASSWORD in cleartext to
// `${BLOG_API_BASE}/api/admin/login`. BLOG_API_BASE is an env var, so whoever can set it picks
// where production credentials land — that used to be a free-text workflow_dispatch input, i.e.
// anyone with write access could exfiltrate the admin password to their own host. The workflow
// now reads `vars.BLOG_API_BASE`; the guard exercised here is the second line of defence.
//
// NEVER run smoke-check.mjs itself from a test: it talks to the live backend. Every case below
// drives `main()` with an injected fake fetch and asserts on the calls it did (or did not) make.

const PRODUCTION_BASE = 'https://ai-blog-hbur.onrender.com'
const CANONICAL_BASE = 'https://www.563118077.xyz'
const ADMIN_PASSWORD = 'pw-must-never-leave-the-process'

const ADMIN_ENV = {
  PUBLIC_SITE_URL: CANONICAL_BASE,
  BLOG_API_BASE: PRODUCTION_BASE,
  INCLUDE_ADMIN_SMOKE: '1',
  ADMIN_USERNAME: 'smoke-admin',
  ADMIN_PASSWORD,
}

function createFakeFetch({ token = 'smoke-token' } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const target = String(url)
    calls.push({ url: target, method: init.method || 'GET', headers: init.headers || {}, body: init.body })
    const payload = target.includes('/api/admin/login') ? { access_token: token } : { ok: true }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  fetchImpl.calls = calls
  fetchImpl.urls = () => calls.map((call) => call.url)
  fetchImpl.loginCalls = () => calls.filter((call) => call.url.includes('/api/admin/login'))
  return fetchImpl
}

async function withSilencedLog(fn) {
  const original = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = original
  }
}

/** Nothing the fake fetch saw may contain the password, whatever else the assertion checks. */
function assertNoCredentialEgress(fetchImpl, error) {
  assert.equal(
    JSON.stringify(fetchImpl.calls).includes(ADMIN_PASSWORD),
    false,
    'admin password must not appear in any outbound request',
  )
  if (error) {
    assert.equal(String(error.message).includes(ADMIN_PASSWORD), false, 'error message must not echo the password')
  }
}

// Single source of truth for "may this URL receive admin credentials?". Add a row whenever the
// guard moves. `message` is asserted so a rejection cannot silently change reason (e.g. a host
// that should be refused as unapproved must not start passing merely because the scheme check
// happened to trip first).
export const ADMIN_TARGET_VECTORS = [
  // --- approved production / canonical hosts ---
  { url: PRODUCTION_BASE, allowed: true, label: 'default render backend' },
  { url: CANONICAL_BASE, allowed: true, label: 'canonical www host' },
  { url: 'https://563118077.xyz', allowed: true, label: 'apex host' },
  { url: 'https://www.563118077.xyz/api', allowed: true, label: 'approved host with path' },
  { url: 'https://www.563118077.xyz:8443', allowed: true, label: 'approved host on a non-default port' },
  { url: 'https://WWW.563118077.XYZ', allowed: true, label: 'mixed-case host' },
  { url: 'https://www.563118077.xyz.', allowed: true, label: 'host with DNS root dot' },
  // WHATWG percent-decodes the host before IDNA, so encoding cannot smuggle a host past the
  // allowlist in either direction — this row decodes to the canonical host.
  { url: 'https://www.56311807%37.xyz', allowed: true, label: 'percent-encoded approved host' },

  // --- loopback: http is deliberately tolerated for local runs ---
  { url: 'http://127.0.0.1:8000', allowed: true, label: 'IPv4 loopback over http' },
  { url: 'http://localhost:8000', allowed: true, label: 'localhost over http' },
  { url: 'http://localhost.:8000', allowed: true, label: 'localhost with DNS root dot' },
  { url: 'http://[::1]:8000', allowed: true, label: 'IPv6 loopback literal' },
  { url: 'https://localhost:8000', allowed: true, label: 'localhost over https' },

  // --- unapproved hosts ---
  { url: 'https://evil.example.com', allowed: false, label: 'attacker host', message: /unapproved host "evil\.example\.com"/ },
  { url: 'https://EVIL.example.com', allowed: false, label: 'mixed-case attacker host', message: /unapproved host/ },
  { url: 'https://evil.example.com.', allowed: false, label: 'attacker host with root dot', message: /unapproved host/ },
  { url: 'https://ev%69l.example.com', allowed: false, label: 'percent-encoded attacker host', message: /unapproved host "evil\.example\.com"/ },
  { url: 'https://evil.example.com:443', allowed: false, label: 'attacker host with explicit port', message: /unapproved host/ },
  { url: 'https://www.563118077.xyz.evil.com', allowed: false, label: 'approved host as a subdomain prefix', message: /unapproved host/ },
  { url: 'https://evil.com/?next=https://www.563118077.xyz', allowed: false, label: 'approved host in the query string', message: /unapproved host/ },
  { url: 'https://169.254.169.254', allowed: false, label: 'cloud metadata over https', message: /unapproved host/ },

  // --- transport ---
  { url: 'http://ai-blog-hbur.onrender.com', allowed: false, label: 'http to the production backend', message: /https is required/ },
  { url: 'http://www.563118077.xyz', allowed: false, label: 'http to the canonical host', message: /https is required/ },
  { url: 'http://169.254.169.254', allowed: false, label: 'cloud metadata over http', message: /https is required/ },
  // [::ffff:127.0.0.1] is loopback to the kernel but not to this allowlist: it fails closed.
  { url: 'http://[::ffff:127.0.0.1]:8000', allowed: false, label: 'IPv4-mapped loopback', message: /https is required/ },

  // --- embedded credentials (refused even when the host itself is approved) ---
  { url: 'https://user:pass@www.563118077.xyz', allowed: false, label: 'userinfo on an approved host', message: /must not embed credentials/ },
  { url: 'https://user@www.563118077.xyz', allowed: false, label: 'username only', message: /must not embed credentials/ },
  { url: 'https://www.563118077.xyz@evil.example.com', allowed: false, label: 'approved host used as userinfo', message: /must not embed credentials/ },

  // --- schemes ---
  { url: 'file:///etc/passwd', allowed: false, label: 'file scheme', message: /unsupported protocol file:/ },
  { url: 'ftp://www.563118077.xyz/', allowed: false, label: 'ftp scheme', message: /unsupported protocol ftp:/ },
  { url: 'data:text/plain,hello', allowed: false, label: 'data scheme', message: /unsupported protocol data:/ },

  // --- malformed ---
  { url: '//www.563118077.xyz', allowed: false, label: 'protocol-relative', message: /not a valid URL/ },
  { url: 'www.563118077.xyz', allowed: false, label: 'scheme-less host', message: /not a valid URL/ },
  { url: 'not a url', allowed: false, label: 'garbage string', message: /not a valid URL/ },
  { url: '', allowed: false, label: 'empty string', message: /not a valid URL/ },
  { url: null, allowed: false, label: 'null', message: /not a valid URL/ },
  { url: undefined, allowed: false, label: 'undefined', message: /not a valid URL/ },
]

test('assertSafeAdminTarget matches the admin-target vector table', () => {
  for (const vector of ADMIN_TARGET_VECTORS) {
    if (vector.allowed) {
      const parsed = assertSafeAdminTarget(vector.url)
      assert.equal(parsed.protocol.startsWith('http'), true, `${vector.label}: ${vector.url} should be allowed`)
    } else {
      assert.throws(
        () => assertSafeAdminTarget(vector.url),
        vector.message,
        `${vector.label}: ${String(vector.url)} should be refused`,
      )
    }
  }
})

test('every refusal message starts with "Refusing" and names the offending target', () => {
  for (const vector of ADMIN_TARGET_VECTORS.filter((entry) => !entry.allowed)) {
    let message = ''
    try {
      assertSafeAdminTarget(vector.url)
    } catch (error) {
      message = error.message
    }
    assert.match(message, /^Refusing/, `${vector.label} must fail with an actionable refusal`)
  }
})

test('a backslash cannot move the authority off an approved host', () => {
  // WHATWG treats "\" as a path separator for special schemes, so this stays on the canonical
  // host and the "@evil.example.com" is just a path segment.
  const parsed = assertSafeAdminTarget('https://www.563118077.xyz\\@evil.example.com/api')
  assert.equal(parsed.hostname, 'www.563118077.xyz')
  assert.equal(parsed.pathname.includes('evil.example.com'), true)
})

test('a tab-smuggled host is parsed and refused as the joined host', () => {
  // The URL parser strips tabs/newlines, so the guard and fetch() agree on the final host.
  assert.throws(
    () => assertSafeAdminTarget('https://www.563118077.xyz\t.evil.com'),
    /unapproved host "www\.563118077\.xyz\.evil\.com"/,
  )
})

test('resolveAllowedAdminHosts keeps the production defaults for blank or degenerate values', () => {
  for (const value of [undefined, '', '   ', ',', ' , , ', '.']) {
    const hosts = resolveAllowedAdminHosts({ ALLOWED_SMOKE_HOSTS: value })
    assert.equal(hosts.has('www.563118077.xyz'), true, `${JSON.stringify(value)} must fall back to the defaults`)
    assert.equal(hosts.has('ai-blog-hbur.onrender.com'), true, JSON.stringify(value))
    assert.equal(hosts.has('evil.example.com'), false, `${JSON.stringify(value)} must not widen the allowlist`)
  }
})

test('resolveAllowedAdminHosts replaces the defaults, normalizes entries and always keeps loopback', () => {
  const hosts = resolveAllowedAdminHosts({ ALLOWED_SMOKE_HOSTS: ' Staging.Example.COM. , backup.example.com ,, ' })
  assert.deepEqual(
    [...hosts].sort(),
    ['127.0.0.1', '::1', 'backup.example.com', 'localhost', 'staging.example.com'].sort(),
  )
  assert.equal(hosts.has('www.563118077.xyz'), false, 'an explicit allowlist replaces the built-in hosts')
})

test('ALLOWED_SMOKE_HOSTS authorises exactly the hosts it names', () => {
  const allowedHosts = resolveAllowedAdminHosts({ ALLOWED_SMOKE_HOSTS: 'staging.example.com' })
  assert.equal(assertSafeAdminTarget('https://staging.example.com/api', { allowedHosts }).hostname, 'staging.example.com')
  assert.equal(assertSafeAdminTarget('http://127.0.0.1:8000', { allowedHosts }).hostname, '127.0.0.1')
  assert.throws(() => assertSafeAdminTarget(CANONICAL_BASE, { allowedHosts }), /unapproved host/)
  assert.throws(() => assertSafeAdminTarget('https://evil.example.com', { allowedHosts }), /unapproved host/)
})

test('degenerate ALLOWED_SMOKE_HOSTS entries fail closed instead of widening the allowlist', () => {
  // A wildcard, a full URL or a host:port pair are not hostnames; none of them may match. The
  // operator gets an explicit refusal listing what is allowed rather than a silent pass-through.
  for (const value of ['*', '**', 'https://evil.example.com/x', 'evil.example.com:8443', '.evil.example.com']) {
    const allowedHosts = resolveAllowedAdminHosts({ ALLOWED_SMOKE_HOSTS: value })
    assert.throws(
      () => assertSafeAdminTarget('https://evil.example.com', { allowedHosts }),
      /unapproved host/,
      `ALLOWED_SMOKE_HOSTS=${value} must not authorise evil.example.com`,
    )
  }
})

test('assertSafeAdminTarget normalizes caller-supplied allowlists too', () => {
  const parsed = assertSafeAdminTarget('https://Staging.Example.com./api', {
    allowedHosts: new Set(['STAGING.example.COM.']),
  })
  assert.equal(parsed.hostname, 'staging.example.com.')
})

test('main refuses an unapproved BLOG_API_BASE without emitting a single request', async () => {
  const fetchImpl = createFakeFetch()

  const error = await main({ ...ADMIN_ENV, BLOG_API_BASE: 'https://evil.example.com' }, { fetchImpl }).then(
    () => null,
    (caught) => caught,
  )

  assert.match(String(error?.message), /unapproved host "evil\.example\.com"/)
  // The point of the guard: the credentials never leave the process. Asserting "it threw" would
  // pass even if the login POST had already been sent, so assert on the wire instead.
  assert.equal(fetchImpl.loginCalls().length, 0, 'no /api/admin/login request may be made')
  assert.deepEqual(fetchImpl.urls(), [], 'an unapproved base must not even receive the public probes')
  assertNoCredentialEgress(fetchImpl, error)
})

test('main refuses an http admin target without emitting a single request', async () => {
  const fetchImpl = createFakeFetch()

  const error = await main({ ...ADMIN_ENV, BLOG_API_BASE: 'http://ai-blog-hbur.onrender.com' }, { fetchImpl }).then(
    () => null,
    (caught) => caught,
  )

  assert.match(String(error?.message), /https is required/)
  assert.deepEqual(fetchImpl.urls(), [])
  assertNoCredentialEgress(fetchImpl, error)
})

test('main refuses a credential-embedding BLOG_API_BASE without emitting a single request', async () => {
  const fetchImpl = createFakeFetch()

  const error = await main(
    { ...ADMIN_ENV, BLOG_API_BASE: 'https://user:pass@www.563118077.xyz' },
    { fetchImpl },
  ).then(
    () => null,
    (caught) => caught,
  )

  assert.match(String(error?.message), /must not embed credentials/)
  assert.deepEqual(fetchImpl.urls(), [])
  assertNoCredentialEgress(fetchImpl, error)
})

test('main refuses an admin run with missing credentials before touching the network', async () => {
  const fetchImpl = createFakeFetch()

  await assert.rejects(
    () => main({ ...ADMIN_ENV, ADMIN_PASSWORD: '   ' }, { fetchImpl }),
    /ADMIN_USERNAME\/ADMIN_PASSWORD missing/,
  )
  assert.deepEqual(fetchImpl.urls(), [])
})

test('main refuses to start when required env is missing', async () => {
  const fetchImpl = createFakeFetch()

  await assert.rejects(
    () => main({ ...ADMIN_ENV, BLOG_API_BASE: '' }, { fetchImpl }),
    /Missing required env: BLOG_API_BASE/,
  )
  assert.deepEqual(fetchImpl.urls(), [])
})

test('main runs the full admin smoke against an approved host', async () => {
  const fetchImpl = createFakeFetch()

  await withSilencedLog(() => main(ADMIN_ENV, { fetchImpl }))

  const urls = fetchImpl.urls()
  // The cold-start gate runs first: every check below has a 15s budget, which a sleeping Render
  // instance blows through routinely, so without this the smoke check reports a healthy backend
  // as broken.
  assert.equal(urls[0], `${PRODUCTION_BASE}/readyz`, 'the backend is woken before anything is asserted')
  assert.equal(urls[1], `${CANONICAL_BASE}/`, 'public site is probed first')
  assert.ok(urls.includes(`${PRODUCTION_BASE}/api/public/home-bootstrap`))

  const loginCalls = fetchImpl.loginCalls()
  assert.equal(loginCalls.length, 1)
  assert.equal(loginCalls[0].url, `${PRODUCTION_BASE}/api/admin/login`)
  assert.equal(loginCalls[0].method, 'POST')
  assert.deepEqual(JSON.parse(loginCalls[0].body), { username: 'smoke-admin', password: ADMIN_PASSWORD })

  const planCall = fetchImpl.calls.find((call) => call.url.endsWith('/api/admin/ai-runtime-plan'))
  assert.equal(planCall.headers.Authorization, 'Bearer smoke-token')
})

test('main tolerates a trailing slash and a loopback dev backend', async () => {
  const fetchImpl = createFakeFetch()

  await withSilencedLog(() =>
    main({ ...ADMIN_ENV, BLOG_API_BASE: 'http://127.0.0.1:8000/' }, { fetchImpl }),
  )

  assert.equal(fetchImpl.loginCalls()[0].url, 'http://127.0.0.1:8000/api/admin/login')
})

test('main honours ALLOWED_SMOKE_HOSTS for a fork backend and drops the defaults', async () => {
  const approved = createFakeFetch()
  await withSilencedLog(() =>
    main(
      { ...ADMIN_ENV, BLOG_API_BASE: 'https://staging.example.com', ALLOWED_SMOKE_HOSTS: 'staging.example.com' },
      { fetchImpl: approved },
    ),
  )
  assert.equal(approved.loginCalls().length, 1)

  const narrowed = createFakeFetch()
  await assert.rejects(
    () => main({ ...ADMIN_ENV, ALLOWED_SMOKE_HOSTS: 'staging.example.com' }, { fetchImpl: narrowed }),
    /unapproved host "ai-blog-hbur\.onrender\.com"/,
  )
  assert.deepEqual(narrowed.urls(), [])
  assertNoCredentialEgress(narrowed)
})

test('a public-only run never touches an admin endpoint', async () => {
  const fetchImpl = createFakeFetch()

  await withSilencedLog(() =>
    main({ PUBLIC_SITE_URL: CANONICAL_BASE, BLOG_API_BASE: PRODUCTION_BASE }, { fetchImpl }),
  )

  // One wake probe plus the five public checks.
  assert.equal(fetchImpl.urls().length, 6)
  assert.equal(fetchImpl.urls().some((url) => url.includes('/api/admin/')), false)
})

test('INCLUDE_ADMIN_SMOKE only opts in on the exact value "1"', async () => {
  for (const value of ['true', 'yes', '0', 'on', ' 1 ']) {
    const fetchImpl = createFakeFetch()
    await withSilencedLog(() => main({ ...ADMIN_ENV, INCLUDE_ADMIN_SMOKE: value }, { fetchImpl }))
    assert.equal(fetchImpl.loginCalls().length, 0, `INCLUDE_ADMIN_SMOKE=${value} must not send credentials`)
    assertNoCredentialEgress(fetchImpl)
  }
})

test('a public-only run against an unapproved base still sends no credentials', async () => {
  // Public probes are not host-restricted (they carry no secrets); the invariant is only that
  // nothing credentialed follows.
  const fetchImpl = createFakeFetch()

  await withSilencedLog(() =>
    main({ PUBLIC_SITE_URL: CANONICAL_BASE, BLOG_API_BASE: 'https://evil.example.com' }, { fetchImpl }),
  )

  assert.equal(fetchImpl.loginCalls().length, 0)
  assertNoCredentialEgress(fetchImpl)
})
