const TERMINAL_IMAGE_JOB_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

const DEFAULT_SUBMIT_TIMEOUT_MS = 60000
const DEFAULT_POLL_TIMEOUT_MS = 420000
const DEFAULT_POLL_INTERVAL_MS = 2500
const DEFAULT_JOB_FETCH_TIMEOUT_MS = 15000

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseErrorBody(response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch (error) {
    // The status code is the useful signal here; keep a breadcrumb instead of swallowing
    // the failure silently so an unreadable body is still visible in CI logs.
    return `<unreadable response body: ${error?.message || error}>`
  }
}

export function imageGenerationJobImageUrl(job = {}) {
  return String(job.result_image_url || job.cover_image || job.hero_image || '').trim()
}

export function imageGenerationJobSucceeded(job = {}) {
  return job.status === 'succeeded' && Boolean(imageGenerationJobImageUrl(job))
}

export function imageGenerationJobId(job = {}) {
  const id = Number(job?.job_id ?? job?.id)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function generationEndpoint(targetType, targetId) {
  const id = Number(targetId)
  if (targetType === 'site_hero') return '/api/admin/settings/generate-hero'
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid targetId')
  if (targetType === 'post_cover') return `/api/admin/posts/${id}/generate-cover`
  if (targetType === 'series_cover') return `/api/admin/series/${id}/generate-cover`
  if (targetType === 'topic_cover') return `/api/admin/topic-profiles/${id}/generate-cover`
  throw new Error(`Unsupported image generation target: ${targetType}`)
}

export async function submitImageGenerationJob({
  blogApiBase,
  token,
  targetType = 'post_cover',
  targetId,
  prompt = '',
  coverBrief = '',
  overwrite = false,
  mode = 'apply',
  timeoutMs = DEFAULT_SUBMIT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  const endpoint = generationEndpoint(targetType, targetId)
  const payload = {
    prompt: String(prompt || '').trim() || null,
    overwrite: Boolean(overwrite),
  }
  const normalizedCoverBrief = String(coverBrief || '').trim()
  if (targetType === 'post_cover' && normalizedCoverBrief) payload.cover_brief = normalizedCoverBrief
  if (targetType !== 'site_hero') payload.mode = mode

  const response = await fetchImpl(`${base}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Submit cover generation job failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }
  return response.json()
}

export function submitPostCoverGenerationJob(options = {}) {
  return submitImageGenerationJob({
    ...options,
    targetType: 'post_cover',
    targetId: options.postId,
  })
}

export async function fetchImageGenerationJob({
  blogApiBase,
  token,
  jobId,
  timeoutMs = DEFAULT_JOB_FETCH_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  const id = Number(jobId)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid jobId')

  const response = await fetchImpl(`${base}/api/admin/image-generation-jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Fetch cover generation job failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }
  return response.json()
}

/**
 * Poll an admin image-generation job until it reaches a terminal status.
 *
 * This is the single shared implementation — every caller (auto-blog, backfills,
 * generate-cover-for-post, repair-post-media) should use it rather than keeping a private
 * copy, so poll semantics and the `poll_timeout` contract stay identical everywhere.
 *
 * Tunables:
 *   - `timeoutMs`      total wall-clock budget for polling (default 420s; long-running
 *                      cover models routinely need >180s)
 *   - `intervalMs`     delay between polls (default 2.5s)
 *   - `requestTimeoutMs` per-request timeout for each status GET (default 15s)
 *   - `fetchImpl` / `sleepImpl` injection points for tests
 *   - `label`          prefix used in the timeout message (e.g. "Post cover generation")
 *
 * On timeout it does NOT throw: it returns a synthetic job object carrying
 * `error_code: 'poll_timeout'` (a contract the frontend job store also keys on), because a
 * backgrounded job may still finish successfully after the script gives up.
 */
export async function waitForImageGenerationJob({
  blogApiBase,
  token,
  jobId,
  initialJob = null,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
  requestTimeoutMs = DEFAULT_JOB_FETCH_TIMEOUT_MS,
  fetchImpl = fetch,
  sleepImpl = sleep,
  label = 'Image generation',
} = {}) {
  // An already-terminal payload needs no id: some backends answer the submit call with the
  // finished job inline.
  if (initialJob && TERMINAL_IMAGE_JOB_STATUSES.has(initialJob.status)) return initialJob

  const id = Number(jobId ?? imageGenerationJobId(initialJob || {}))
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid jobId')

  const startedAt = Date.now()
  let latest = initialJob
  while (!latest || !TERMINAL_IMAGE_JOB_STATUSES.has(latest.status)) {
    const elapsedMs = Date.now() - startedAt
    if (elapsedMs > timeoutMs) {
      return {
        ...(latest || {}),
        id,
        job_id: id,
        status: latest?.status === 'queued' ? 'queued' : 'running',
        error_code: 'poll_timeout',
        error: `${label} job ${id} is still running after ${Math.round(elapsedMs / 1000)}s (budget ${Math.round(timeoutMs / 1000)}s); it may still finish in the background.`,
      }
    }
    // Only wait before re-polling; with no initial payload, ask for status immediately.
    if (latest) await sleepImpl(intervalMs)
    latest = await fetchImageGenerationJob({
      blogApiBase,
      token,
      jobId: id,
      timeoutMs: requestTimeoutMs,
      fetchImpl,
    })
  }
  return latest
}

// Submit + poll options are separate on purpose: a single `timeoutMs` used to be spread
// into both calls, so raising the poll budget silently raised the submit budget too.
// `timeoutMs` is still honoured as the submit budget for backwards compatibility.
function splitJobOptions(options = {}) {
  const {
    submitTimeoutMs,
    pollTimeoutMs,
    pollIntervalMs,
    requestTimeoutMs,
    timeoutMs,
    intervalMs,
    label,
    ...shared
  } = options
  return {
    submit: {
      ...shared,
      timeoutMs: submitTimeoutMs ?? timeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS,
    },
    poll: {
      blogApiBase: shared.blogApiBase,
      token: shared.token,
      fetchImpl: shared.fetchImpl,
      sleepImpl: shared.sleepImpl,
      timeoutMs: pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
      intervalMs: pollIntervalMs ?? intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      requestTimeoutMs: requestTimeoutMs ?? DEFAULT_JOB_FETCH_TIMEOUT_MS,
      ...(label ? { label } : {}),
    },
  }
}

async function generateTargetImageViaAdminJob(targetType, options = {}) {
  const { submit, poll } = splitJobOptions(options)
  const job = await submitImageGenerationJob({
    ...submit,
    targetType,
    targetId: targetType === 'post_cover' ? (options.postId ?? options.targetId) : options.targetId,
  })
  return waitForImageGenerationJob({
    ...poll,
    jobId: imageGenerationJobId(job),
    initialJob: job,
  })
}

export function generatePostCoverViaAdminJob(options = {}) {
  return generateTargetImageViaAdminJob('post_cover', options)
}

export function generateSeriesCoverViaAdminJob(options = {}) {
  return generateTargetImageViaAdminJob('series_cover', options)
}

export function generateTopicCoverViaAdminJob(options = {}) {
  return generateTargetImageViaAdminJob('topic_cover', options)
}

export function generateSiteHeroViaAdminJob(options = {}) {
  return generateTargetImageViaAdminJob('site_hero', options)
}
