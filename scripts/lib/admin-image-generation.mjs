const TERMINAL_IMAGE_JOB_STATUSES = new Set(['succeeded', 'failed', 'canceled'])

const DEFAULT_SUBMIT_TIMEOUT_MS = 60000
const DEFAULT_POLL_TIMEOUT_MS = 180000
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

export async function submitPostCoverGenerationJob({
  blogApiBase,
  token,
  postId,
  prompt = '',
  overwrite = false,
  mode = 'apply',
  timeoutMs = DEFAULT_SUBMIT_TIMEOUT_MS,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  const id = Number(postId)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  if (!Number.isFinite(id) || id <= 0) throw new Error('Missing or invalid postId')

  const response = await fetch(`${base}/api/admin/posts/${id}/generate-cover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt: String(prompt || '').trim() || null,
      overwrite: Boolean(overwrite),
      mode,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Submit cover generation job failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }
  return response.json()
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
