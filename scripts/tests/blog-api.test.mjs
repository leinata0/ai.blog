import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquireAdminToken,
  fetchAdminPostsByOffset,
  fetchWithTransientRetry,
  findAdminPostByExactSlug,
  iterateAdminPostPages,
  waitForBackendAwake,
} from '../lib/blog-api.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Node surfaces an `AbortSignal.timeout` abort as a DOMException named TimeoutError; this is
// exactly what a Render cold start looks like from the client side.
function timeoutError() {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

function fakeClock(startMs = 0) {
  let now = startMs
  return {
    nowImpl: () => now,
    sleepImpl: async (ms) => { now += ms },
    advance: (ms) => { now += ms },
  }
}

const silentLogger = { log() {}, warn() {} }

test('fetchAdminPostsByOffset translates arbitrary offsets into backend page queries', async () => {
  const calls = []
  const posts = Array.from({ length: 130 }, (_, index) => ({
    id: index + 1,
    slug: `post-${index + 1}`,
  }))
  const fetchImpl = async (url) => {
    calls.push(url)
    const parsed = new URL(url)
    const page = Number(parsed.searchParams.get('page'))
    const pageSize = Number(parsed.searchParams.get('page_size'))
    const start = (page - 1) * pageSize
    return jsonResponse({
      items: posts.slice(start, start + pageSize),
      total: posts.length,
    })
  }

  const result = await fetchAdminPostsByOffset({
    blogApiBase: 'https://blog.example',
    token: 'token',
    limit: 60,
    offset: 25,
    fetchImpl,
  })

  assert.equal(result.length, 60)
  assert.equal(result[0].id, 26)
  assert.equal(result.at(-1).id, 85)
  assert.deepEqual(
    calls.map((url) => new URL(url).search),
    ['?page=1&page_size=50', '?page=2&page_size=50'],
  )
})

test('findAdminPostByExactSlug scans admin pages and includes drafts', async () => {
  const posts = Array.from({ length: 55 }, (_, index) => ({
    id: index + 1,
    slug: index === 52 ? 'draft-target' : `post-${index + 1}`,
    is_published: index !== 52,
  }))
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    const page = Number(parsed.searchParams.get('page'))
    const pageSize = Number(parsed.searchParams.get('page_size'))
    const start = (page - 1) * pageSize
    return jsonResponse({
      items: posts.slice(start, start + pageSize),
      total: posts.length,
    })
  }

  const result = await findAdminPostByExactSlug({
    blogApiBase: 'https://blog.example',
    token: 'token',
    slug: 'draft-target',
    fetchImpl,
  })

  assert.equal(result?.id, 53)
  assert.equal(result?.is_published, false)
})

// --- cold start -----------------------------------------------------------------
//
// The backend runs on a Render free-tier instance that spins down when idle. A real run of
// `repair-post-media.mjs --slug ...` died with "The operation was aborted due to timeout" and
// only succeeded after `/readyz` had been curled by hand first. Earlier, adding a 30s timeout to
// `publish-content-file.mjs` broke a workflow that had been passing precisely *because* it had no
// timeout and could sit through the cold start. Both are the same defect: the first request of a
// run pays 50s+ that no per-request budget should have to cover.

test('acquireAdminToken absorbs a cold start on /readyz before any credential is sent', async () => {
  const clock = fakeClock()
  const seen = []
  let probes = 0

  const token = await acquireAdminToken({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async (url, options = {}) => {
      seen.push({ url, body: options.body })
      if (url.endsWith('/readyz')) {
        probes += 1
        // The instance is asleep: the first probes never come back at all.
        if (probes <= 3) {
          clock.advance(20000)
          throw timeoutError()
        }
        return jsonResponse({ status: 'ok' })
      }
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: silentLogger,
  })

  assert.equal(token, 'jwt-token')
  assert.deepEqual(
    seen.map((call) => new URL(call.url).pathname),
    ['/readyz', '/readyz', '/readyz', '/readyz', '/api/admin/login'],
  )
  // The password is only ever serialised once the instance has answered.
  assert.equal(seen.filter((call) => String(call.body || '').includes('secret')).length, 1)
})

test('a wake probe that never answers still lets the real request run and report', async () => {
  const clock = fakeClock()
  let probes = 0
  let logins = 0

  const token = await acquireAdminToken({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async (url) => {
      if (url.endsWith('/readyz')) {
        probes += 1
        clock.advance(20000)
        throw timeoutError()
      }
      logins += 1
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: silentLogger,
    wake: { budgetMs: 60000, probeIntervalMs: 5000 },
  })

  // The probe gave up but did not throw: a login failure is a far more actionable error than
  // "the wake probe gave up", and the instance may well have woken on the last probe.
  assert.ok(probes >= 2)
  assert.equal(logins, 1)
  assert.equal(token, 'jwt-token')
})

test('acquireAdminToken fails fast on a missing password instead of waiting out the wake budget', async () => {
  await assert.rejects(
    acquireAdminToken({
      blogApiBase: 'https://blog.example',
      password: '',
      fetchImpl: async () => { throw new Error('no request may be made without a password') },
    }),
    /Missing ADMIN_PASSWORD/,
  )
})

test('every login retry builds a fresh abort signal', async () => {
  const signals = []
  let attempts = 0

  await acquireAdminToken({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/readyz')) return jsonResponse({ status: 'ok' })
      attempts += 1
      signals.push(options.signal)
      if (attempts < 3) return new Response('Too Many Requests', { status: 429 })
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: async () => {},
    logger: silentLogger,
  })

  assert.equal(signals.length, 3)
  // `AbortSignal.timeout()` is one-shot. A signal hoisted out of the loop would already have
  // fired by the time the second attempt ran, aborting every retry instantly.
  assert.equal(new Set(signals).size, 3)
  for (const signal of signals) assert.ok(signal instanceof AbortSignal)
})

test('fetchWithTransientRetry gives every attempt its own signal and honours a disabled timeout', async () => {
  const signals = []
  let attempts = 0

  await fetchWithTransientRetry(
    async (_url, options = {}) => {
      signals.push(options.signal)
      attempts += 1
      if (attempts < 3) throw timeoutError()
      return jsonResponse({ ok: true })
    },
    'https://blog.example/api/admin/posts',
    { headers: { Authorization: 'Bearer t' } },
    { attempts: 5, sleepImpl: async () => {} },
  )

  assert.equal(signals.length, 3)
  assert.equal(new Set(signals).size, 3)

  // timeoutMs <= 0 means "the caller owns the signal": nothing is injected.
  const passthrough = []
  await fetchWithTransientRetry(
    async (_url, options) => { passthrough.push(options); return jsonResponse({}) },
    'https://blog.example/api/admin/posts',
    { headers: { Authorization: 'Bearer t' } },
    { timeoutMs: 0 },
  )
  assert.equal(passthrough[0].signal, undefined)
})

// --- paging ---------------------------------------------------------------------

test('iterateAdminPostPages rides out a transient 503 during a rolling deploy', async () => {
  let calls = 0
  const pages = []

  for await (const page of iterateAdminPostPages({
    blogApiBase: 'https://blog.example',
    token: 'token',
    pageSize: 2,
    fetchImpl: async () => {
      calls += 1
      if (calls < 3) return new Response('deploying', { status: 503 })
      return jsonResponse({ items: [{ id: 1 }], total: 1 })
    },
    retryOptions: { sleepImpl: async () => {} },
  })) {
    pages.push(page)
  }

  assert.equal(calls, 3)
  assert.equal(pages.length, 1)
  assert.equal(pages[0].last, true)
})

test('iterateAdminPostPages marks the natural end and refuses to spin past the ceiling', async () => {
  const ended = []
  for await (const page of iterateAdminPostPages({
    blogApiBase: 'https://blog.example',
    token: 'token',
    pageSize: 2,
    fetchImpl: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      return jsonResponse(page === 1
        ? { items: [{ id: 1 }, { id: 2 }], total: 3 }
        : { items: [{ id: 3 }], total: 3 })
    },
  })) {
    ended.push(page.last)
  }
  assert.deepEqual(ended, [false, true])

  // A backend that omits `total` and always answers with a full page used to page forever.
  const seen = []
  for await (const page of iterateAdminPostPages({
    blogApiBase: 'https://blog.example',
    token: 'token',
    pageSize: 1,
    maxPages: 4,
    fetchImpl: async (url) => jsonResponse({ items: [{ id: Number(new URL(url).searchParams.get('page')) }] }),
  })) {
    seen.push(page.page)
  }
  // Four pages, none of them flagged `last` — that is how callers tell "hit the ceiling" from
  // "reached the end of the archive".
  assert.deepEqual(seen, [1, 2, 3, 4])
})

test('iterateAdminPostPages rejects a malformed list body instead of reporting an empty archive', async () => {
  await assert.rejects(async () => {
    for await (const page of iterateAdminPostPages({
      blogApiBase: 'https://blog.example',
      token: 'token',
      fetchImpl: async () => jsonResponse({ items: null, total: 12 }),
    })) {
      assert.ok(page)
    }
  }, /invalid response body/)
})

test('the wake probe never throws, whatever the backend does', async () => {
  const clock = fakeClock()
  const outcome = await waitForBackendAwake({
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => { throw new TypeError('fetch failed') },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: silentLogger,
    budgetMs: 20000,
    probeIntervalMs: 5000,
  })
  assert.equal(outcome.awake, false)
  assert.ok(outcome.attempts >= 1)
})
