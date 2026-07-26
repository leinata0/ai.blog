import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOrUpdatePost,
  fetchExistingPostBySlug,
  isTransientNetworkError,
  loginWithRetry,
  resolveExistingCover,
  waitForBackendAwake,
} from '../publish-content-file.mjs'

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

function fakeClock(startMs = 0) {
  let now = startMs
  return {
    nowImpl: () => now,
    sleepImpl: async (ms) => {
      now += ms
    },
    advance: (ms) => {
      now += ms
    },
  }
}

test('publisher searches every admin page for an exact slug', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('page=1&')) {
      return jsonResponse({ items: [{ id: 1, slug: 'other' }], total: 2 })
    }
    return jsonResponse({ items: [{ id: 5, slug: 'target' }], total: 2 })
  }

  const result = await fetchExistingPostBySlug('target', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl,
    pageSize: 1,
  })

  assert.equal(result.id, 5)
  assert.equal(calls.length, 2)
})

test('publisher respects the admin API default page-size limit', async () => {
  let requestedUrl = ''
  await fetchExistingPostBySlug('missing', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl: async (url) => {
      requestedUrl = url
      return jsonResponse({ items: [], total: 0 })
    },
  })

  assert.match(requestedUrl, /page_size=50$/)
})

test('publisher retries transient admin-list failures during rolling deploys', async () => {
  let attempts = 0
  const result = await fetchExistingPostBySlug('target', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 3) return new Response('deploying', { status: 502 })
      return jsonResponse({ items: [{ id: 5, slug: 'target' }], total: 1 })
    },
    retryOptions: { attempts: 3, sleepImpl: async () => {} },
  })

  assert.equal(result.id, 5)
  assert.equal(attempts, 3)
})

test('publisher preserves an existing post cover', () => {
  assert.equal(
    resolveExistingCover({}, { cover_image: 'https://img.example/existing.jpg' }),
    'https://img.example/existing.jpg',
  )
  assert.equal(
    resolveExistingCover({ cover_image: 'https://img.example/article.jpg' }, { cover_image: 'old.jpg' }),
    'https://img.example/article.jpg',
  )
})

test('every retried admin-list attempt gets a fresh abort signal', async () => {
  const signals = []
  let attempts = 0
  await fetchExistingPostBySlug('target', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl: async (_url, options) => {
      signals.push(options.signal)
      attempts += 1
      if (attempts < 2) return new Response('deploying', { status: 503 })
      return jsonResponse({ items: [{ id: 5, slug: 'target' }], total: 1 })
    },
    retryOptions: { attempts: 3, sleepImpl: async () => {}, timeoutMs: 30000 },
  })

  assert.equal(signals.length, 2)
  assert.ok(signals[0] instanceof AbortSignal)
  // A single hoisted signal would already be aborted (or about to be) on the retry.
  assert.notEqual(signals[0], signals[1])
})

test('cold-start probe waits through timeouts until the instance answers', async () => {
  const clock = fakeClock()
  let probes = 0
  const result = await waitForBackendAwake({
    blogApiBase: 'https://blog.example',
    fetchImpl: async (url) => {
      assert.equal(url, 'https://blog.example/readyz')
      probes += 1
      // Render free-tier cold start: the first probes never come back at all.
      if (probes <= 3) {
        clock.advance(20000)
        throw timeoutError()
      }
      return jsonResponse({ status: 'ok' })
    },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: null,
    probeIntervalMs: 5000,
    budgetMs: 180000,
  })

  assert.equal(result.awake, true)
  assert.equal(result.ready, true)
  assert.equal(probes, 4)
  // 3 x (20s timeout + 5s backoff) — well past the 30s that used to kill the whole run.
  assert.equal(result.elapsedMs, 75000)
})

test('cold-start probe keeps waiting while readyz reports 503 but stops on any other status', async () => {
  const clock = fakeClock()
  let probes = 0
  const stillWarming = await waitForBackendAwake({
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => {
      probes += 1
      if (probes < 3) return jsonResponse({ status: 'not_ready' }, 503)
      return jsonResponse({ status: 'ok' })
    },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: null,
  })
  assert.equal(stillWarming.ready, true)
  assert.equal(probes, 3)

  // An older deploy without /readyz answers 404 — the process is clearly up, so stop waiting.
  const legacyClock = fakeClock()
  const legacy = await waitForBackendAwake({
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => new Response('not found', { status: 404 }),
    sleepImpl: legacyClock.sleepImpl,
    nowImpl: legacyClock.nowImpl,
    logger: null,
  })
  assert.equal(legacy.awake, true)
  assert.equal(legacy.ready, false)
  assert.equal(legacy.attempts, 1)
})

test('cold-start probe gives up within its budget instead of hanging the job', async () => {
  const clock = fakeClock()
  let probes = 0
  const result = await waitForBackendAwake({
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => {
      probes += 1
      clock.advance(20000)
      throw timeoutError()
    },
    sleepImpl: clock.sleepImpl,
    nowImpl: clock.nowImpl,
    logger: null,
    probeIntervalMs: 5000,
    budgetMs: 60000,
  })

  // Never throws: the real login error is more actionable than "the probe gave up".
  assert.equal(result.awake, false)
  assert.equal(probes, 3)
  // The budget is checked before each sleep, so the worst case is budget + one probe timeout.
  assert.ok(result.elapsedMs <= 60000 + 20000, `elapsedMs=${result.elapsedMs}`)
})

test('admin login survives a cold-start timeout instead of failing the run', async () => {
  const clock = fakeClock()
  const delays = []
  let attempts = 0

  const token = await loginWithRetry({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw timeoutError()
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: async (ms) => {
      delays.push(ms)
      await clock.sleepImpl(ms)
    },
    logger: null,
  })

  assert.equal(token, 'jwt-token')
  assert.equal(attempts, 2)
  assert.deepEqual(delays, [10000])
})

test('admin login retries the 5/minute rate limit with a window-clearing backoff', async () => {
  const delays = []
  let attempts = 0

  const token = await loginWithRetry({
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    fetchImpl: async () => {
      attempts += 1
      if (attempts < 3) return new Response('Too Many Requests', { status: 429 })
      return jsonResponse({ access_token: 'jwt-token' })
    },
    sleepImpl: async (ms) => {
      delays.push(ms)
    },
    logger: null,
  })

  assert.equal(token, 'jwt-token')
  assert.deepEqual(delays, [10000, 30000])
  // The backoff must be able to outlast a one-minute rate-limit window.
  assert.ok(delays.reduce((sum, ms) => sum + ms, 0) >= 40000)
})

test('admin login does not retry bad credentials', async () => {
  let attempts = 0
  await assert.rejects(
    loginWithRetry({
      blogApiBase: 'https://blog.example',
      username: 'admin',
      password: 'wrong',
      fetchImpl: async () => {
        attempts += 1
        return new Response('Invalid credentials', { status: 401 })
      },
      sleepImpl: async () => {
        throw new Error('must not sleep on a deterministic 401')
      },
      logger: null,
    }),
    /Admin login failed: 401/,
  )
  assert.equal(attempts, 1)
})

test('admin login refuses to run without a password', async () => {
  await assert.rejects(
    loginWithRetry({ blogApiBase: 'https://blog.example', password: '', fetchImpl: async () => {
      throw new Error('must not call the API without a password')
    } }),
    /Missing ADMIN_PASSWORD/,
  )
})

test('publish upserts by slug: PUT when the post exists, POST only when it does not', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method })
    return jsonResponse({ id: 42, slug: 'demo' })
  }

  await createOrUpdatePost({ slug: 'demo' }, { id: 42 }, 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl,
  })
  await createOrUpdatePost({ slug: 'demo' }, null, 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl,
  })

  assert.deepEqual(calls, [
    { url: 'https://blog.example/api/admin/posts/42', method: 'PUT' },
    { url: 'https://blog.example/api/admin/posts', method: 'POST' },
  ])
})

test('publish retries a transient failure on the write call', async () => {
  let attempts = 0
  const result = await createOrUpdatePost({ slug: 'demo' }, { id: 42 }, 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl: async () => {
      attempts += 1
      if (attempts === 1) throw timeoutError()
      if (attempts === 2) return new Response('bad gateway', { status: 502 })
      return jsonResponse({ id: 42, slug: 'demo' })
    },
    retryOptions: { attempts: 4, sleepImpl: async () => {} },
  })

  assert.equal(result.id, 42)
  assert.equal(attempts, 3)
})

test('cold-start symptoms are classified as retryable, deterministic errors are not', () => {
  assert.equal(isTransientNetworkError(timeoutError()), true)
  assert.equal(isTransientNetworkError(new TypeError('fetch failed')), true)
  assert.equal(isTransientNetworkError(Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' })), true)
  assert.equal(isTransientNetworkError(new Error('Article file is missing required fields')), false)
})
