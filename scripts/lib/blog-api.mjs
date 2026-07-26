// Shared client layer for every script that talks to the blog admin API.
//
// Historically each script carried its own copy of "log in, then page through /api/admin/posts",
// with a different timeout on each copy (15s here, 30s there, none in a third) and no retries.
// That divergence is the direct cause of the production failures this module exists to prevent:
// the backend runs on a Render instance that spins down when idle, so the *first* request of any
// run pays a cold start that routinely exceeds 50s. A 15s or 30s budget on that first request
// aborts a run that would otherwise have succeeded.
//
// The contract every caller now shares:
//   1. `waitForBackendAwake()` absorbs the cold start with a cheap unauthenticated probe that has
//      its own long budget and never throws.
//   2. Only then do credentialed requests run, each with a per-request timeout plus retries.
//   3. Every retry builds a *fresh* `AbortSignal.timeout()`. The object is one-shot; sharing one
//      across attempts makes each retry abort instantly.

const DEFAULT_LOCAL_API_BASE = 'http://127.0.0.1:8000'

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

// Per-request budgets deliberately mirror auto-blog.mjs (`loginAdminWithRetry` /
// `sendPublishRequest`): 30s per admin request, login backoff [10s, 30s, 60s]. Keeping the
// numbers identical means one place to reason about how patient the pipeline is.
export const REQUEST_TIMEOUT_MS = 30000
export const LOGIN_RETRY_DELAYS_MS = [10000, 30000, 60000]

// The wake probe gets its own, much longer budget than any real request: it is unauthenticated,
// costs nothing, and is not subject to the 5/minute login rate limit, so it is the right place to
// spend the minutes a cold start can take.
export const WAKE_PROBE_PATH = '/readyz'
export const WAKE_PROBE_TIMEOUT_MS = 20000
export const WAKE_PROBE_INTERVAL_MS = 5000
export const WAKE_TOTAL_BUDGET_MS = 180000

const DEFAULT_TRANSIENT_ATTEMPTS = 7

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function backoffDelayMs(attempt) {
  return Math.min(1000 * 2 ** (attempt - 1), 8000)
}

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

export function resolveBlogApiBase(defaultBase = DEFAULT_LOCAL_API_BASE) {
  const value = String(process.env.BLOG_API_BASE || defaultBase || '')
    .trim()
    .replace(/\/$/, '')

  if (!value) {
    throw new Error('BLOG_API_BASE is required.')
  }

  return value
}

export function resolveAdminUsername(defaultUsername = 'admin') {
  return String(process.env.ADMIN_USERNAME || process.env.DEV_ADMIN_USERNAME || defaultUsername).trim() || defaultUsername
}

export function resolveAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || process.env.DEV_ADMIN_PASSWORD || '').trim()
}

// --- transient-failure classification -------------------------------------------

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP_STATUSES.has(Number(status || 0))
}

// Mirrors auto-blog.mjs's `isRetryableAdminLoginError`: a timeout/abort/DNS/connection blip is
// exactly what a cold start looks like from the client side, so it must stay retryable.
export function isTransientNetworkError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || /timeout|aborted|network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(`${code} ${message}`)
}

/**
 * `fetch` with a per-attempt timeout and retries on transient HTTP statuses / network errors.
 *
 * `timeoutMs <= 0` disables the timeout entirely (the caller has its own signal). Removing the
 * timeout by default is never the answer: an unbounded request is how a hung backend pins a CI
 * job forever. The cold start is absorbed by `waitForBackendAwake` instead.
 */
export async function fetchWithTransientRetry(
  fetchImpl,
  url,
  options,
  { attempts = DEFAULT_TRANSIENT_ATTEMPTS, sleepImpl = sleep, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  let response
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // A fresh signal per attempt: `AbortSignal.timeout()` is one-shot, so hoisting it into
      // the shared options object would make every retry abort instantly.
      response = await fetchImpl(
        url,
        timeoutMs > 0 ? { ...options, signal: AbortSignal.timeout(timeoutMs) } : options,
      )
    } catch (error) {
      if (attempt === attempts || !isTransientNetworkError(error)) throw error
      await sleepImpl(backoffDelayMs(attempt))
      continue
    }
    if (!isTransientHttpStatus(response.status) || attempt === attempts) return response
    await sleepImpl(backoffDelayMs(attempt))
  }
  return response
}

// --- cold start -----------------------------------------------------------------

/**
 * Absorb a Render cold start before any real request runs.
 *
 * Never throws: if the budget runs out we still attempt the real request, because the failure of
 * that request is a far more actionable error message than "the wake probe gave up".
 *
 * `/readyz` answering 503 means the process is up but its DB/storage checks have not passed yet,
 * which is still worth waiting for. Any other status means the instance is up and answering
 * (e.g. an older deploy without `/readyz`), so the cold start is already over.
 */
export async function waitForBackendAwake({
  blogApiBase = resolveBlogApiBase(),
  fetchImpl = fetch,
  sleepImpl = sleep,
  nowImpl = Date.now,
  logger = console,
  probePath = WAKE_PROBE_PATH,
  probeTimeoutMs = WAKE_PROBE_TIMEOUT_MS,
  probeIntervalMs = WAKE_PROBE_INTERVAL_MS,
  budgetMs = WAKE_TOTAL_BUDGET_MS,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  const startedAt = nowImpl()
  let attempts = 0
  let lastDetail = 'no response'

  for (;;) {
    attempts += 1
    try {
      const resp = await fetchImpl(`${base}${probePath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(probeTimeoutMs),
      })
      if (resp.ok) {
        return { awake: true, ready: true, status: resp.status, attempts, elapsedMs: nowImpl() - startedAt }
      }
      if (resp.status !== 503) {
        return { awake: true, ready: false, status: resp.status, attempts, elapsedMs: nowImpl() - startedAt }
      }
      lastDetail = `HTTP ${resp.status}`
    } catch (error) {
      lastDetail = error?.message || String(error)
    }

    const elapsedMs = nowImpl() - startedAt
    if (elapsedMs + probeIntervalMs >= budgetMs) {
      logger?.warn?.(
        `Backend still not answering ${probePath} after ${Math.round(elapsedMs / 1000)}s (${lastDetail}); continuing anyway.`,
      )
      return { awake: false, ready: false, attempts, elapsedMs }
    }

    logger?.log?.(
      `Waiting for backend cold start (${probePath} attempt ${attempts}: ${lastDetail}); retrying in ${Math.round(probeIntervalMs / 1000)}s...`,
    )
    await sleepImpl(probeIntervalMs)
  }
}

// --- admin login ----------------------------------------------------------------

/**
 * Same shape as auto-blog.mjs's `loginAdminWithRetry`. `POST /api/admin/login` is rate limited to
 * 5/minute, so the backoff has to be long enough to clear the window — and `waitForBackendAwake`
 * exists so cold starts do not burn those five attempts.
 */
export async function loginWithRetry({
  blogApiBase = resolveBlogApiBase(),
  username = resolveAdminUsername(),
  password = resolveAdminPassword(),
  fetchImpl = fetch,
  sleepImpl = sleep,
  logger = console,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelaysMs = LOGIN_RETRY_DELAYS_MS,
} = {}) {
  if (!password) throw new Error('Missing ADMIN_PASSWORD')

  const base = trimBaseUrl(blogApiBase)
  const attempts = retryDelaysMs.length + 1
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resp = await fetchImpl(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        // Fresh per attempt — a hoisted `AbortSignal.timeout` would abort every retry instantly.
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!resp.ok) {
        const error = new Error(`Admin login failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
        error.status = resp.status
        throw error
      }
      const token = String((await resp.json())?.access_token || '').trim()
      if (!token) throw new Error('Admin login failed: missing access_token')
      return token
    } catch (error) {
      lastError = error
      const status = Number(error?.status || 0)
      // Bad credentials are deterministic; retrying only wastes the rate-limit budget.
      const retryable = status ? isTransientHttpStatus(status) : isTransientNetworkError(error)
      if (!retryable || attempt >= attempts) break

      const delayMs = retryDelaysMs[attempt - 1]
      logger?.warn?.(
        `Admin login attempt ${attempt}/${attempts} failed (${error?.message || 'unknown error'}); retrying in ${Math.round(delayMs / 1000)}s...`,
      )
      await sleepImpl(delayMs)
    }
  }

  throw lastError || new Error('Admin login failed')
}

/**
 * The one way every script should obtain an admin token: wake first, then log in.
 *
 * Scripts driven by `workflow_dispatch` are the dangerous case — a manual trigger means the
 * instance is almost certainly asleep, so for them a cold start is the default, not an edge case.
 */
export async function acquireAdminToken({
  blogApiBase = resolveBlogApiBase(),
  username = resolveAdminUsername(),
  password = resolveAdminPassword(),
  fetchImpl = fetch,
  sleepImpl = sleep,
  nowImpl = Date.now,
  logger = console,
  wake = {},
  login = {},
} = {}) {
  // Fail fast on a missing secret rather than after a three-minute wake wait.
  if (!password) throw new Error('Missing ADMIN_PASSWORD')

  const status = await waitForBackendAwake({ blogApiBase, fetchImpl, sleepImpl, nowImpl, logger, ...wake })
  if (status.awake && status.attempts > 1) {
    const probePath = wake.probePath || WAKE_PROBE_PATH
    logger?.log?.(
      `Backend answered ${probePath} after ${Math.round(status.elapsedMs / 1000)}s (${status.attempts} probe(s))`,
    )
  }

  return loginWithRetry({ blogApiBase, username, password, fetchImpl, sleepImpl, logger, ...login })
}

// --- admin post paging ----------------------------------------------------------

/**
 * The single paginator for `GET /api/admin/posts`.
 *
 * There used to be four of these (one in this file, one each in repair-post-media,
 * publish-content-file and publish-article), all subtly different about when to stop and none of
 * them retrying. Yields `{ page, items, total, last }`; `last` marks the natural final page, so a
 * caller that exhausts `maxPages` without ever seeing it knows it hit the ceiling rather than the
 * end of the archive — the distinction between "done" and "gave up".
 */
export async function* iterateAdminPostPages({
  blogApiBase,
  token,
  pageSize = 50,
  startPage = 1,
  maxPages = 1000,
  query = {},
  fetchImpl = fetch,
  retryOptions,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  if (!base) throw new Error('BLOG_API_BASE is required.')
  if (!token) throw new Error('Admin token is required.')

  // The admin list endpoint caps page_size at 50; asking for more silently returns 50 and would
  // make the "a short page means the end" test fire on every page.
  const size = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 50)))
  const firstPage = Math.max(1, Math.floor(Number(startPage) || 1))
  const pageCeiling = Math.max(1, Math.floor(Number(maxPages) || 1))

  for (let index = 0; index < pageCeiling; index += 1) {
    const page = firstPage + index
    const params = new URLSearchParams({ page: String(page), page_size: String(size) })
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
    }

    const response = await fetchWithTransientRetry(
      fetchImpl,
      `${base}/api/admin/posts?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
      retryOptions,
    )
    if (!response.ok) {
      throw new Error(`Failed to load admin posts: ${response.status} ${(await response.text()).slice(0, 300)}`)
    }

    const data = await response.json()
    // A non-array `items` is a broken contract, not an empty archive. Coercing it to [] would end
    // the scan and report "not found" for a post that exists.
    if (!Array.isArray(data?.items)) throw new Error('Failed to load admin posts: invalid response body')

    const items = data.items
    const total = Number(data?.total)
    const last = items.length < size || (Number.isFinite(total) && page * size >= total)
    yield { page, pageSize: size, items, total: Number.isFinite(total) ? total : null, last }
    if (last) return
  }
}

export async function fetchAdminPostsByOffset({
  blogApiBase,
  token,
  limit = 50,
  offset = 0,
  fetchImpl = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryOptions,
} = {}) {
  const requestedLimit = Math.max(1, Math.floor(Number(limit) || 50))
  const requestedOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const pageSize = Math.min(50, requestedLimit)
  let leadingSkip = requestedOffset % pageSize
  const results = []

  const pages = iterateAdminPostPages({
    blogApiBase,
    token,
    pageSize,
    startPage: Math.floor(requestedOffset / pageSize) + 1,
    fetchImpl,
    retryOptions: { timeoutMs, ...retryOptions },
  })

  for await (const page of pages) {
    const available = page.items.slice(leadingSkip)
    results.push(...available.slice(0, requestedLimit - results.length))
    leadingSkip = 0
    if (results.length >= requestedLimit) break
  }

  return results
}

export async function findAdminPostByExactSlug({
  blogApiBase,
  token,
  slug,
  fetchImpl = fetch,
  pageSize = 50,
  maxPages = 20,
  retryOptions,
} = {}) {
  const targetSlug = String(slug || '').trim()
  if (!targetSlug) return null

  const pages = iterateAdminPostPages({ blogApiBase, token, pageSize, maxPages, fetchImpl, retryOptions })
  for await (const page of pages) {
    const match = page.items.find((item) => String(item?.slug || '') === targetSlug)
    if (match) return match
  }

  return null
}
