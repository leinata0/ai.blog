#!/usr/bin/env node

import { isAbsolute, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { buildPostCoverBrief } from './lib/cover-art.mjs'
import {
  generatePostCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

const ARTICLE_FILE = process.env.ARTICLE_FILE || './content/blog-migration-neon-r2.mjs'
const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

// Per-request budgets deliberately mirror auto-blog.mjs (`loginAdminWithRetry` /
// `sendPublishRequest`): 30s per admin request, login backoff [10s, 30s, 60s]. Keeping the
// numbers identical means one place to reason about how patient the pipeline is.
const REQUEST_TIMEOUT_MS = 30000
const LOGIN_RETRY_DELAYS_MS = [10000, 30000, 60000]

// The backend runs on a Render instance that spins down when idle, so the *first* request of
// a run pays the cold start (routinely 50s+, sometimes more) while every later request is
// fast. A bare 30s timeout on the login hop therefore aborted every cold-start run — that is
// precisely how this workflow started failing after timeouts were introduced.
//
// The fix is not a bigger number on every call. It is a cheap, unauthenticated probe with its
// own long budget that absorbs the cold start up front, so the real calls — which carry
// credentials and hit a 5/minute login rate limit — only ever run against a warm instance.
const WAKE_PROBE_PATH = '/readyz'
const WAKE_PROBE_TIMEOUT_MS = 20000
const WAKE_PROBE_INTERVAL_MS = 5000
const WAKE_TOTAL_BUDGET_MS = 180000

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function backoffDelayMs(attempt) {
  return Math.min(1000 * 2 ** (attempt - 1), 8000)
}

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

async function fetchWithTransientRetry(
  fetchImpl,
  url,
  options,
  { attempts = 7, sleepImpl = sleep, timeoutMs = REQUEST_TIMEOUT_MS } = {},
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

// A Windows-absolute ARTICLE_FILE used to be handed straight to `new URL(raw, base)`. WHATWG
// parses the leading `C:` as a URL *scheme*, so the result is the opaque `c:\tmp\a.mjs` —
// protocol `c:`, not a `file:` URL, and not importable. (No characters are lost; the string
// survives verbatim. The defect is purely that it is no longer a file URL.)
// Resolve on the filesystem first, then convert.
export function resolveArticleFileUrl(articleFile = ARTICLE_FILE, baseDir = dirname(fileURLToPath(import.meta.url))) {
  const raw = String(articleFile || '').trim()
  if (!raw) throw new Error('ARTICLE_FILE is empty')
  if (/^file:\/\//i.test(raw)) return new URL(raw)
  const absolutePath = isAbsolute(raw) ? raw : resolve(baseDir, raw)
  return pathToFileURL(absolutePath)
}

async function loadArticle() {
  const mod = await import(resolveArticleFileUrl())
  return mod.default || mod.article || mod
}

/**
 * Absorb a Render cold start before any credentialed call runs.
 *
 * Never throws: if the budget runs out we still attempt the real request, because the login
 * failure is a far more actionable error message than "the wake probe gave up".
 *
 * `/readyz` answering 503 means the process is up but its DB/storage checks have not passed
 * yet, which is still worth waiting for. Any other status means the instance is up and
 * answering (e.g. an older deploy without `/readyz`), so the cold start is already over.
 */
export async function waitForBackendAwake({
  blogApiBase = BLOG_API_BASE,
  fetchImpl = fetch,
  sleepImpl = sleep,
  nowImpl = Date.now,
  logger = console,
  probePath = WAKE_PROBE_PATH,
  probeTimeoutMs = WAKE_PROBE_TIMEOUT_MS,
  probeIntervalMs = WAKE_PROBE_INTERVAL_MS,
  budgetMs = WAKE_TOTAL_BUDGET_MS,
} = {}) {
  const startedAt = nowImpl()
  let attempts = 0
  let lastDetail = 'no response'

  for (;;) {
    attempts += 1
    try {
      const resp = await fetchImpl(`${blogApiBase}${probePath}`, {
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

// Same shape as auto-blog.mjs's `loginAdminWithRetry`. `POST /api/admin/login` is rate limited
// to 5/minute, so the backoff has to be long enough to clear the window — and the wake gate
// above exists so cold starts do not burn those five attempts.
export async function loginWithRetry({
  blogApiBase = BLOG_API_BASE,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
  fetchImpl = fetch,
  sleepImpl = sleep,
  logger = console,
  timeoutMs = REQUEST_TIMEOUT_MS,
  retryDelaysMs = LOGIN_RETRY_DELAYS_MS,
} = {}) {
  if (!password) throw new Error('Missing ADMIN_PASSWORD')

  const attempts = retryDelaysMs.length + 1
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resp = await fetchImpl(`${blogApiBase}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
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

export async function fetchExistingPostBySlug(
  slug,
  token,
  { blogApiBase = BLOG_API_BASE, fetchImpl = fetch, pageSize = 50, maxPages = 1000, retryOptions } = {},
) {
  // Unbounded `for (;;)` paged forever if the API kept returning full pages (or a bad
  // `total`). Cap it so a server-side anomaly cannot pin the script in an infinite loop.
  for (let page = 1; page <= maxPages; page += 1) {
    const listResp = await fetchWithTransientRetry(
      fetchImpl,
      `${blogApiBase}/api/admin/posts?page=${page}&page_size=${pageSize}`,
      { headers: { Authorization: `Bearer ${token}` } },
      retryOptions,
    )
    if (!listResp.ok) {
      throw new Error(`Failed to load admin posts: ${listResp.status} ${(await listResp.text()).slice(0, 300)}`)
    }

    const data = await listResp.json()
    const items = Array.isArray(data.items) ? data.items : []
    const existingPost = items.find((item) => item.slug === slug)
    if (existingPost) return existingPost

    const total = Number(data.total)
    const reachedKnownEnd = Number.isFinite(total) && page * pageSize >= total
    if (reachedKnownEnd || items.length < pageSize) return null
  }

  throw new Error(`Failed to resolve slug within ${maxPages} pages: ${slug}`)
}

export function resolveExistingCover(article, existingPost) {
  return String(article.cover_image || existingPost?.cover_image || '').trim()
}

function normalizeArticle(article, coverImage) {
  return {
    title: String(article.title || '').trim(),
    slug: String(article.slug || '').trim(),
    summary: String(article.summary || '').trim(),
    content_md: String(article.content_md || '').trim(),
    tags: Array.isArray(article.tags) ? article.tags : [],
    cover_image: coverImage || String(article.cover_image || '').trim(),
    is_published: article.is_published !== false,
    is_pinned: article.is_pinned === true,
  }
}

// Upsert by slug: PUT the post found by `fetchExistingPostBySlug`, POST only when the slug is
// genuinely absent. Reruns of this workflow update the same row instead of creating copies,
// and the backend's unique slug constraint (409) is the backstop if the lookup ever misses.
export async function createOrUpdatePost(post, existingPost, token, {
  blogApiBase = BLOG_API_BASE,
  fetchImpl = fetch,
  retryOptions,
} = {}) {
  const url = existingPost
    ? `${blogApiBase}/api/admin/posts/${existingPost.id}`
    : `${blogApiBase}/api/admin/posts`
  const method = existingPost ? 'PUT' : 'POST'

  const resp = await fetchWithTransientRetry(
    fetchImpl,
    url,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(post),
    },
    retryOptions,
  )

  if (!resp.ok) {
    throw new Error(`${method} post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  return resp.json()
}

async function main() {
  // Fail fast on a missing secret rather than after a three-minute wake wait.
  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')

  const article = await loadArticle()
  if (!article.title || !article.slug || !article.content_md) {
    throw new Error('Article file is missing required fields')
  }

  console.log(`Loaded article: ${article.title}`)

  const wake = await waitForBackendAwake()
  if (wake.awake) {
    console.log(`Backend answered ${WAKE_PROBE_PATH} after ${Math.round(wake.elapsedMs / 1000)}s (${wake.attempts} probe(s))`)
  }

  const token = await loginWithRetry()
  console.log('Admin login OK')

  const existingPost = await fetchExistingPostBySlug(article.slug, token)
  if (existingPost) {
    console.log(`Existing post found: id=${existingPost.id}`)
  } else {
    console.log('No existing post with the same slug, creating a new one')
  }

  const coverImage = resolveExistingCover(article, existingPost)
  const coverBrief = buildPostCoverBrief(article, {
    manualBrief: String(article.cover_brief || article.cover_prompt || '').trim(),
  })
  const payload = normalizeArticle(article, coverImage)
  const result = await createOrUpdatePost(payload, existingPost, token)

  if (!coverImage && coverBrief) {
    console.log('Generating cover with the configured image channel...')
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: BLOG_API_BASE,
      token,
      postId: result.id,
      coverBrief,
      overwrite: false,
    })
    if (!imageGenerationJobSucceeded(job)) {
      throw new Error(job.error || `Configured image channel failed: ${job.error_code || job.status || 'unknown_error'}`)
    }
    console.log(`Cover generated: ${imageGenerationJobImageUrl(job)}`)
  }

  console.log(`Post published successfully: id=${result.id} slug=${result.slug}`)
  console.log(`${BLOG_API_BASE}/api/posts/${result.slug}`)
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
