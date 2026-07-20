const TERMINAL_IMAGE_JOB_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

const DEFAULT_SUBMIT_TIMEOUT_MS = 60000
const DEFAULT_POLL_TIMEOUT_MS = 420000
const DEFAULT_POLL_INTERVAL_MS = 2500

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseErrorBody(response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

export function imageGenerationJobImageUrl(job = {}) {
  return String(job.result_image_url || job.cover_image || job.hero_image || '').trim()
}

export function imageGenerationJobSucceeded(job = {}) {
  return job.status === 'succeeded' && Boolean(imageGenerationJobImageUrl(job))
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

  const response = await fetch(`${base}${endpoint}`, {
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
  timeoutMs = 15000,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  const id = Number(jobId)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid jobId')

  const response = await fetch(`${base}/api/admin/image-generation-jobs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Fetch cover generation job failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }
  return response.json()
}

export async function waitForImageGenerationJob({
  blogApiBase,
  token,
  jobId,
  initialJob = null,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_POLL_TIMEOUT_MS,
} = {}) {
  const id = Number(jobId || initialJob?.job_id || initialJob?.id)
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid jobId')

  const startedAt = Date.now()
  let latest = initialJob
  while (!latest || !TERMINAL_IMAGE_JOB_STATUSES.has(latest.status)) {
    if (Date.now() - startedAt > timeoutMs) {
      return {
        ...(latest || {}),
        id,
        job_id: id,
        status: latest?.status === 'queued' ? 'queued' : 'running',
        error_code: 'poll_timeout',
        error: '封面生成任务仍在后台执行，请稍后刷新查看结果。',
      }
    }
    await sleep(intervalMs)
    latest = await fetchImageGenerationJob({ blogApiBase, token, jobId: id })
  }
  return latest
}

export async function generatePostCoverViaAdminJob(options = {}) {
  const job = await submitPostCoverGenerationJob(options)
  return waitForImageGenerationJob({
    ...options,
    jobId: job.job_id || job.id,
    initialJob: job,
  })
}

async function generateTargetImageViaAdminJob(targetType, options = {}) {
  const job = await submitImageGenerationJob({
    ...options,
    targetType,
    targetId: options.targetId,
  })
  return waitForImageGenerationJob({
    ...options,
    jobId: job.job_id || job.id,
    initialJob: job,
  })
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
