/**
 * Admin job tracker for image + text generation.
 * Merges session-local tracking with server history (cross-device).
 */

const MAX_JOBS = 50
const STORAGE_KEY = 'admin_generation_jobs_v1'
const listeners = new Set()

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'timeout', 'unknown'])

function nowIso() {
  return new Date().toISOString()
}

function readStorage() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStorage(nextJobs) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextJobs.slice(0, MAX_JOBS)))
  } catch {
    // ignore quota / private mode
  }
}

let jobs = readStorage()

function emit() {
  const snapshot = jobs.slice()
  listeners.forEach((listener) => {
    try {
      listener(snapshot)
    } catch {
      // listener errors must not break the store
    }
  })
}

function normalizeStatus(status) {
  const value = String(status || 'queued').toLowerCase()
  if (value === 'success') return 'succeeded'
  if (value === 'error') return 'failed'
  if (value === 'cancelled') return 'canceled'
  return value
}

function matchesJob(job, partial) {
  if (partial.localId && job.localId === partial.localId) return true
  if (
    partial.kind
    && job.kind
    && partial.kind === job.kind
    && partial.jobId != null
    && job.jobId != null
    && String(job.jobId) === String(partial.jobId)
  ) {
    return true
  }
  if (partial.jobId != null && job.jobId != null && String(job.jobId) === String(partial.jobId)) {
    // Prefer same kind when both known
    if (partial.kind && job.kind && partial.kind !== job.kind) return false
    return true
  }
  return false
}

export function getAdminJobs() {
  return jobs.slice()
}

export function subscribeAdminJobs(listener) {
  listeners.add(listener)
  listener(jobs.slice())
  return () => listeners.delete(listener)
}

export function clearFinishedAdminJobs() {
  jobs = jobs.filter((job) => !TERMINAL.has(normalizeStatus(job.status)))
  writeStorage(jobs)
  emit()
}

export function dismissAdminJob(localIdOrJobId) {
  jobs = jobs.filter(
    (job) => job.localId !== localIdOrJobId && String(job.jobId) !== String(localIdOrJobId),
  )
  writeStorage(jobs)
  emit()
}

/**
 * Upsert a tracked job. Prefer jobId+kind when known so bulk submit + poll merge.
 */
export function upsertAdminJob(partial) {
  const localId = partial.localId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const index = jobs.findIndex((job) => matchesJob(job, { ...partial, localId }))

  const base = index >= 0 ? jobs[index] : null
  const next = {
    localId: base?.localId || localId,
    jobId: partial.jobId ?? base?.jobId ?? null,
    kind: partial.kind || base?.kind || 'image_generation',
    label: partial.label || base?.label || '生成任务',
    detail: partial.detail !== undefined ? partial.detail : (base?.detail || ''),
    status: normalizeStatus(partial.status || base?.status || 'queued'),
    error: partial.error !== undefined ? partial.error : (base?.error || ''),
    resultUrl: partial.resultUrl !== undefined ? partial.resultUrl : (base?.resultUrl || ''),
    resultPreview: partial.resultPreview !== undefined ? partial.resultPreview : (base?.resultPreview || ''),
    targetType: partial.targetType || base?.targetType || '',
    targetId: partial.targetId !== undefined ? partial.targetId : (base?.targetId ?? null),
    source: partial.source || base?.source || 'local',
    createdAt: base?.createdAt || partial.createdAt || nowIso(),
    updatedAt: nowIso(),
  }

  if (index >= 0) {
    jobs = jobs.slice()
    jobs[index] = next
  } else {
    jobs = [next, ...jobs].slice(0, MAX_JOBS)
  }

  writeStorage(jobs)
  emit()
  return next
}

/**
 * Merge server history items into the local store (does not wipe local-only jobs).
 */
export function mergeServerHistory(items = []) {
  if (!Array.isArray(items) || items.length === 0) return getAdminJobs()

  for (const item of items) {
    if (!item || item.job_id == null) continue
    const kind = item.kind === 'text_generation' || item.kind === 'text'
      ? 'text_generation'
      : 'image_generation'
    upsertAdminJob({
      jobId: item.job_id,
      kind,
      label: item.label || (kind === 'text_generation' ? '文本生成' : '图片生成'),
      detail: item.detail || '',
      status: item.status,
      error: item.error || '',
      resultUrl: item.result_url || '',
      resultPreview: item.result_preview || '',
      targetType: item.target_type || '',
      targetId: item.target_id ?? null,
      source: 'server',
      createdAt: item.created_at || undefined,
    })
  }

  // Re-sort: newest updated first
  jobs = jobs
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))
    .slice(0, MAX_JOBS)
  writeStorage(jobs)
  emit()
  return getAdminJobs()
}

export function countActiveAdminJobs(list = jobs) {
  return list.filter((job) => !TERMINAL.has(normalizeStatus(job.status))).length
}

export function jobStatusLabel(status) {
  switch (normalizeStatus(status)) {
    case 'queued':
      return '排队中'
    case 'running':
      return '生成中'
    case 'succeeded':
      return '已完成'
    case 'failed':
      return '失败'
    case 'canceled':
      return '已取消'
    case 'timeout':
      return '仍在后台'
    default:
      return status || '未知'
  }
}

export function summarizeImageJobResult(result, fallbackLabel = '图片生成') {
  if (!result) {
    return { status: 'unknown', error: '无结果', label: fallbackLabel, jobId: null, resultUrl: '' }
  }
  if (result.maybe_running || result.error_code === 'submit_timeout_no_job_id') {
    return {
      status: 'timeout',
      error: result.error || '任务可能仍在后台执行',
      label: fallbackLabel,
      jobId: result.job_id || result.id || null,
      resultUrl: '',
    }
  }
  if (result.error_code === 'poll_timeout' || result.error_code === 'poll_transient_timeout') {
    return {
      status: 'timeout',
      error: result.error || '轮询超时，任务可能仍在后台',
      label: fallbackLabel,
      jobId: result.job_id || result.id || null,
      resultUrl: '',
    }
  }
  const status = normalizeStatus(result.status)
  if (status === 'succeeded' || result.generated) {
    return {
      status: 'succeeded',
      error: '',
      label: fallbackLabel,
      jobId: result.job_id || result.id || null,
      resultUrl: result.cover_image || result.hero_image || result.result_image_url || '',
    }
  }
  if (status === 'failed' || result.error) {
    return {
      status: status === 'queued' || status === 'running' ? 'failed' : (status || 'failed'),
      error: result.error || '生成失败',
      label: fallbackLabel,
      jobId: result.job_id || result.id || null,
      resultUrl: '',
    }
  }
  return {
    status: status || 'running',
    error: result.error || '',
    label: fallbackLabel,
    jobId: result.job_id || result.id || null,
    resultUrl: '',
  }
}

export function summarizeTextJobResult(result, fallbackLabel = '文本生成') {
  if (!result) {
    return { status: 'unknown', error: '无结果', label: fallbackLabel, jobId: null, resultPreview: '' }
  }
  const status = normalizeStatus(result.status)
  const jobId = result.job_id || result.id || null
  if (status === 'succeeded' || result.generated) {
    const content = String(result.content || '').trim()
    return {
      status: 'succeeded',
      error: '',
      label: fallbackLabel,
      jobId,
      resultPreview: content.length > 80 ? `${content.slice(0, 80)}…` : content,
    }
  }
  if (status === 'failed' || result.error) {
    return {
      status: status === 'queued' || status === 'running' ? 'failed' : (status || 'failed'),
      error: result.error || '文本生成失败',
      label: fallbackLabel,
      jobId,
      resultPreview: '',
    }
  }
  if (result.error_code === 'poll_timeout') {
    return {
      status: 'timeout',
      error: result.error || '轮询超时，任务可能仍在后台',
      label: fallbackLabel,
      jobId,
      resultPreview: '',
    }
  }
  return {
    status: status || 'running',
    error: result.error || '',
    label: fallbackLabel,
    jobId,
    resultPreview: '',
  }
}

/**
 * Track image job through submit + poll lifecycle.
 */
export async function trackAdminImageJob({
  label,
  detail = '',
  targetType = '',
  targetId = null,
  submit,
  wait,
}) {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  upsertAdminJob({
    localId,
    label,
    detail,
    targetType,
    targetId,
    status: 'queued',
    kind: 'image_generation',
    source: 'local',
  })

  let submitted
  try {
    submitted = await submit()
  } catch (error) {
    upsertAdminJob({
      localId,
      label,
      detail,
      targetType,
      targetId,
      status: 'failed',
      error: error?.message || '提交失败',
      kind: 'image_generation',
    })
    throw error
  }

  const jobId = submitted?.job_id || submitted?.id || null
  const early = summarizeImageJobResult(submitted, label)
  upsertAdminJob({
    localId,
    jobId,
    label,
    detail,
    targetType,
    targetId,
    status: jobId ? (early.status === 'failed' ? 'failed' : 'running') : early.status,
    error: early.error || '',
    resultUrl: early.resultUrl || '',
    kind: 'image_generation',
  })

  if (!wait || !jobId) {
    return submitted
  }

  const result = await wait(submitted)
  const summary = summarizeImageJobResult(result, label)
  upsertAdminJob({
    localId,
    jobId: summary.jobId || jobId,
    label,
    detail,
    targetType,
    targetId,
    status: summary.status,
    error: summary.error || '',
    resultUrl: summary.resultUrl || '',
    kind: 'image_generation',
  })
  return result
}

/**
 * Track text job through submit + poll lifecycle (same dock as image jobs).
 */
export async function trackAdminTextJob({
  label = '文本生成',
  detail = '',
  submit,
  wait,
}) {
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  upsertAdminJob({
    localId,
    label,
    detail,
    targetType: 'text',
    status: 'queued',
    kind: 'text_generation',
    source: 'local',
  })

  let submitted
  try {
    submitted = await submit()
  } catch (error) {
    upsertAdminJob({
      localId,
      label,
      detail,
      targetType: 'text',
      status: 'failed',
      error: error?.message || '提交失败',
      kind: 'text_generation',
    })
    throw error
  }

  const jobId = submitted?.job_id || submitted?.id || null
  const early = summarizeTextJobResult(submitted, label)
  upsertAdminJob({
    localId,
    jobId,
    label,
    detail,
    targetType: 'text',
    status: jobId ? (early.status === 'failed' ? 'failed' : 'running') : early.status,
    error: early.error || '',
    resultPreview: early.resultPreview || '',
    kind: 'text_generation',
  })

  if (!wait || !jobId) {
    return submitted
  }

  const result = await wait(submitted)
  const summary = summarizeTextJobResult(result, label)
  upsertAdminJob({
    localId,
    jobId: summary.jobId || jobId,
    label,
    detail: detail || [result?.provider, result?.model].filter(Boolean).join(' · '),
    targetType: 'text',
    status: summary.status,
    error: summary.error || '',
    resultPreview: summary.resultPreview || '',
    kind: 'text_generation',
  })
  return result
}
