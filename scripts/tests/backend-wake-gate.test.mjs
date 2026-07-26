import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Every script here is `workflow_dispatch` only or hand-run. A manual trigger means the Render
// free-tier instance is almost certainly spun down, so for these scripts a 50s+ cold start is the
// *default* case, not an edge case — and a bare 15s/30s per-request timeout on the first call
// aborts a run that would otherwise have succeeded. That is not a hypothetical: a real
// `repair-post-media.mjs --slug ...` run died with "The operation was aborted due to timeout" and
// only worked after `/readyz` had been curled by hand first.
//
// The invariant these tests lock down is the one that fix depends on: a cheap unauthenticated
// `/readyz` probe, with its own long budget, runs before the first credentialed request — and
// failing that probe never fails the run.
//
// NEVER let one of these scripts talk to the real backend from a test: every case injects fetch.

const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const silentLogger = { log() {}, warn() {} }

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Node reports an `AbortSignal.timeout` abort as a DOMException named TimeoutError.
function timeoutError() {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

/**
 * A backend that is asleep: the first `coldProbes` requests to /readyz never come back, then the
 * instance is up. Advances a fake clock so the wake budget is spent in virtual time.
 */
function sleepingBackend({ coldProbes = 2, token = 'jwt-token' } = {}) {
  let now = 0
  const calls = []
  const state = {
    calls,
    paths: () => calls.map((call) => new URL(call.url).pathname),
    nowImpl: () => now,
    sleepImpl: async (ms) => { now += ms },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body })
      if (String(url).endsWith('/readyz')) {
        if (calls.filter((call) => call.url.endsWith('/readyz')).length <= coldProbes) {
          now += 20000
          throw timeoutError()
        }
        return jsonResponse({ status: 'ok' })
      }
      return jsonResponse({ access_token: token })
    },
  }
  return state
}

// Each entry is a script whose *first* request of the run is the admin login, so the wake gate
// lives in the token helper itself.
const TOKEN_ENTRY_POINTS = [
  { module: '../generate-cover-for-post.mjs', name: 'login' },
  { module: '../generate-site-hero.mjs', name: 'login' },
  { module: '../backfill-series-covers.mjs', name: 'login' },
  { module: '../backfill-quality-snapshots.mjs', name: 'getAdminToken' },
  { module: '../backfill-topic-profiles.mjs', name: 'getAdminToken' },
]

for (const entry of TOKEN_ENTRY_POINTS) {
  const label = `${entry.module.replace('../', '')}::${entry.name}`

  test(`${label} wakes the backend before it sends the admin password`, async () => {
    const backend = sleepingBackend({ coldProbes: 2 })
    const module = await import(entry.module)
    const acquire = module[entry.name]
    assert.equal(typeof acquire, 'function', `${label} must be exported`)

    const token = await acquire({
      blogApiBase: 'https://blog.example',
      username: 'admin',
      password: 'secret',
      fetchImpl: backend.fetchImpl,
      sleepImpl: backend.sleepImpl,
      nowImpl: backend.nowImpl,
      logger: silentLogger,
    })

    assert.equal(token, 'jwt-token')
    assert.deepEqual(backend.paths(), ['/readyz', '/readyz', '/readyz', '/api/admin/login'])
    // The credential is serialised exactly once, and only after the instance answered.
    const credentialed = backend.calls.filter((call) => String(call.body || '').includes('secret'))
    assert.equal(credentialed.length, 1)
    assert.equal(new URL(backend.calls.at(-1).url).pathname, '/api/admin/login')
  })

  test(`${label} still logs in when the wake probe never answers`, async () => {
    let now = 0
    let logins = 0
    const module = await import(entry.module)

    const token = await module[entry.name]({
      blogApiBase: 'https://blog.example',
      username: 'admin',
      password: 'secret',
      fetchImpl: async (url) => {
        if (String(url).endsWith('/readyz')) {
          now += 20000
          throw timeoutError()
        }
        logins += 1
        return jsonResponse({ access_token: 'jwt-token' })
      },
      sleepImpl: async (ms) => { now += ms },
      nowImpl: () => now,
      logger: silentLogger,
      // Keep the give-up budget short; the point is that giving up is not fatal.
      wake: { budgetMs: 40000, probeIntervalMs: 5000 },
    })

    // A probe that gives up must not fail the run: the real request's own error is far more
    // actionable than "the wake probe gave up", and the instance may have woken on the last probe.
    assert.equal(logins, 1)
    assert.equal(token, 'jwt-token')
  })

  test(`${label} refuses to make any request without a password`, async () => {
    const module = await import(entry.module)
    await assert.rejects(
      module[entry.name]({
        blogApiBase: 'https://blog.example',
        password: '',
        fetchImpl: async () => { throw new Error('no request may be made without a password') },
      }),
      /Missing ADMIN_PASSWORD/,
    )
  })
}

// repair-post-media wakes in `main()` rather than in `adminLogin`, because its first request is
// not always the login: a `--dry-run` without `--post-id` starts with the *public* post fetch.
// The login itself must still survive a cold start on its own — this is the exact call that
// produced "The operation was aborted due to timeout" in production, at 15s with no retry.
test('repair-post-media::adminLogin retries a cold-start timeout instead of aborting the run', async () => {
  const { adminLogin } = await import('../repair-post-media.mjs')
  const delays = []
  let attempts = 0

  const token = await adminLogin({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 3) throw timeoutError()
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: async (ms) => { delays.push(ms) },
    logger: silentLogger,
  })

  assert.equal(token, 'jwt-token')
  assert.equal(attempts, 3)
  // The backoff has to be able to outlast the 5/minute login rate-limit window.
  assert.deepEqual(delays, [10000, 30000])
})

test('repair-post-media::adminLogin does not burn the rate limit on bad credentials', async () => {
  const { adminLogin } = await import('../repair-post-media.mjs')
  let attempts = 0

  await assert.rejects(
    adminLogin({
      blogApiBase: 'https://blog.example',
      username: 'admin',
      password: 'wrong',
      fetchImpl: async () => {
        attempts += 1
        return new Response('Invalid credentials', { status: 401 })
      },
      sleepImpl: async () => { throw new Error('must not sleep on a deterministic 401') },
      logger: silentLogger,
    }),
    /Admin login failed: 401/,
  )
  assert.equal(attempts, 1)
})

// The root cause of the inconsistent timeouts was eight independent copies of "POST
// /api/admin/login", each free to evolve its own budget and retry policy. Convergence only holds
// if new copies cannot quietly reappear.
test('no script hand-rolls its own admin login any more', async () => {
  // auto-blog.mjs keeps its own `loginAdminWithRetry` (it also holds a cross-process lock around
  // the 5/minute window); smoke-check.mjs POSTs the login deliberately, because asserting on that
  // exact response *is* the check — retrying there would mask the failure it exists to catch.
  const allowed = new Set(['auto-blog.mjs', 'smoke-check.mjs'])
  const entries = await readdir(scriptsDir, { withFileTypes: true })
  const offenders = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs') || allowed.has(entry.name)) continue
    const source = await readFile(resolve(scriptsDir, entry.name), 'utf8')
    if (/['"`][^'"`]*\/api\/admin\/login/.test(source)) offenders.push(entry.name)
  }

  assert.deepEqual(
    offenders,
    [],
    'route admin login through lib/blog-api.mjs::acquireAdminToken so the wake gate and backoff cannot drift',
  )
})
