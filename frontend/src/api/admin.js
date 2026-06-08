import { getToken } from './auth'
import { apiDelete, apiGet, apiPost, apiPut, buildApiUrl, clearApiGetCache } from './client'

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
const ADMIN_LIST_CACHE_OPTIONS = Object.freeze({
  auth: true,
  cache: true,
  cacheTtl: 12000,
  staleTtl: 45000,
  staleWhileRevalidate: true,
})
const ADMIN_STATUS_CACHE_OPTIONS = Object.freeze({
  auth: true,
  cache: true,
  cacheTtl: 10000,
  staleTtl: 30000,
  staleWhileRevalidate: true,
})
const ADMIN_IMAGE_GENERATION_SUBMIT_TIMEOUT_MS = 60000
const ADMIN_IMAGE_GENERATION_POLL_REQUEST_TIMEOUT_MS = 15000
const ADMIN_IMAGE_GENERATION_STILL_RUNNING_MESSAGE = '生成任务仍在后台执行，请稍后刷新查看结果。'
const ADMIN_IMAGE_GENERATION_SUBMIT_TIMEOUT_MESSAGE = '生成请求已发送，但服务器响应较慢；任务可能仍在后台执行，请稍后刷新页面查看结果。'

export async function adminLogin(username, password) {
  return apiPost('/api/admin/login', { username, password })
}

export const adminCreatePost = (data) => apiPost('/api/admin/posts', data, {
  auth: true,
  invalidatePaths: ['/api/admin/posts', '/api/posts', '/api/discover', '/api/home/modules', '/api/stats', '/api/search'],
})
export const adminUpdatePost = (id, data) => apiPut(`/api/admin/posts/${id}`, data, {
  auth: true,
  invalidatePaths: [`/api/admin/posts/${id}`, '/api/admin/posts', '/api/posts', '/api/discover', '/api/home/modules', '/api/search'],
})
export const adminDeletePost = (id) => apiDelete(`/api/admin/posts/${id}`, {
  auth: true,
  invalidatePaths: [`/api/admin/posts/${id}`, '/api/admin/posts', '/api/posts', '/api/discover', '/api/home/modules', '/api/stats', '/api/search'],
})
export const fetchAdminImageGenerationJob = (id, requestOptions = {}) =>
  apiGet(`/api/admin/image-generation-jobs/${id}`, { ...requestOptions, auth: true, cache: false, forceRefresh: true, dedupe: false })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function isAdminImageGenerationSubmitTimeout(error) {
  return error?.name === 'AbortError' && /请求超时/.test(String(error?.message || ''))
}

function isTransientImageGenerationPollError(error) {
  const message = String(error?.message || '')
  return error?.name === 'AbortError'
    || /请求超时|请求已取消|无法连接后端 API|network|failed to fetch/i.test(message)
}

function imageGenerationSubmitPossiblyRunning() {
  return {
    generated: false,
    status: 'running',
    error: ADMIN_IMAGE_GENERATION_SUBMIT_TIMEOUT_MESSAGE,
    error_code: 'submit_timeout_no_job_id',
    maybe_running: true,
  }
}

function imageGenerationStillRunning(jobId, latest, errorCode = 'poll_timeout') {
  return {
    ...(latest || {}),
    job_id: latest?.job_id || latest?.id || jobId,
    status: latest?.status === 'queued' ? 'queued' : 'running',
    error: ADMIN_IMAGE_GENERATION_STILL_RUNNING_MESSAGE,
    error_code: errorCode,
  }
}

async function submitAdminImageGeneration(path, data = {}, requestOptions = {}) {
  try {
    return await apiPost(path, data, { auth: true, timeout: ADMIN_IMAGE_GENERATION_SUBMIT_TIMEOUT_MS, ...requestOptions })
  } catch (error) {
    if (isAdminImageGenerationSubmitTimeout(error)) {
      return imageGenerationSubmitPossiblyRunning()
    }
    throw error
  }
}

function invalidateImageGenerationCaches(job) {
  const common = ['/api/home/modules', '/api/search']
  const byType = {
    post_cover: [`/api/admin/posts/${job.target_id}`, '/api/admin/posts', '/api/posts', '/api/discover', ...common],
    site_hero: ['/api/settings', '/api/stats', '/api/public/home-bootstrap', '/api/home/modules'],
    series_cover: [`/api/admin/series/${job.target_id}`, '/api/admin/series', '/api/series', ...common],
    topic_cover: [`/api/admin/topic-profiles/${job.target_id}`, '/api/admin/topic-profiles', '/api/topics', ...common],
  }
  const paths = byType[job?.job_type] || []
  paths.filter(Boolean).forEach((path) => clearApiGetCache(path))
}

export async function waitForAdminImageGenerationJob(jobOrId, { intervalMs = 2500, timeoutMs = 180000 } = {}) {
  const jobId = typeof jobOrId === 'object' ? (jobOrId.job_id || jobOrId.id) : jobOrId
  if (!jobId) return jobOrId
  const terminal = new Set(['succeeded', 'failed', 'canceled'])
  let latest = typeof jobOrId === 'object' ? jobOrId : null
  if (latest && !latest.status && (latest.generated || latest.error_code)) return latest
  const startedAt = Date.now()
  while (!latest || !terminal.has(latest.status)) {
    if (Date.now() - startedAt > timeoutMs) {
      return imageGenerationStillRunning(jobId, latest)
    }
    await sleep(intervalMs)
    try {
      latest = await fetchAdminImageGenerationJob(jobId, { timeout: ADMIN_IMAGE_GENERATION_POLL_REQUEST_TIMEOUT_MS })
    } catch (error) {
      if (!isTransientImageGenerationPollError(error)) throw error
      latest = imageGenerationStillRunning(jobId, latest, 'poll_transient_timeout')
    }
  }
  if (latest?.status === 'succeeded') {
    invalidateImageGenerationCaches(latest)
  }
  return latest
}

export const generateAdminPostCover = (id, data = {}, requestOptions = {}) =>
  submitAdminImageGeneration(`/api/admin/posts/${id}/generate-cover`, data, requestOptions)

export async function adminUploadImage(file) {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error('图片大小不能超过 10MB')
  }
  const formData = new FormData()
  formData.append('file', file)
  return apiPost('/api/admin/upload', formData, { auth: true })
}

export const fetchSettings = (requestOptions = {}) => apiGet('/api/settings', requestOptions)
export const fetchAdminSettings = () => apiGet('/api/settings', { auth: true, cache: false, forceRefresh: true, dedupe: false })
export const updateSettings = (data) => apiPut('/api/settings', data, {
  auth: true,
  invalidatePaths: ['/api/settings', '/api/stats', '/api/home/modules', '/api/public/home-bootstrap'],
})
export const generateAdminHeroImage = (data = {}) =>
  submitAdminImageGeneration('/api/admin/settings/generate-hero', data)

export const fetchAdminPosts = (params = {}, requestOptions = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/posts${qs ? `?${qs}` : ''}`, { ...ADMIN_LIST_CACHE_OPTIONS, ...requestOptions, auth: true })
}

export const fetchAdminComments = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/comments${qs ? `?${qs}` : ''}`, { auth: true })
}

export const approveComment = (id) => apiPut(`/api/admin/comments/${id}/approve`, {}, {
  auth: true,
  invalidatePaths: ['/api/admin/comments'],
})
export const deleteComment = (id) => apiDelete(`/api/admin/comments/${id}`, {
  auth: true,
  invalidatePaths: ['/api/admin/comments'],
})

export const fetchAdminStats = () => apiGet('/api/admin/stats', { auth: true })
export const fetchAdminPublishingStatus = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/publishing-status${qs ? `?${qs}` : ''}`, { auth: true })
}
export const upsertAdminPublishingStatus = (data) =>
  apiPost('/api/admin/publishing-status', data, {
    auth: true,
    invalidatePaths: ['/api/admin/publishing-status', '/api/home/modules'],
  })

export const fetchAdminImages = () => apiGet('/api/admin/images', { auth: true })
export const deleteAdminImage = (filename) => apiDelete(`/api/admin/images/${filename}`, {
  auth: true,
  invalidatePaths: ['/api/admin/images'],
})

export const fetchAdminContentHealth = () => apiGet('/api/admin/content-health', { auth: true })
export const fetchAdminPublishingRunDetail = (id) =>
  apiGet(`/api/admin/publishing-runs/${id}`, { auth: true })
export const fetchAdminQualityInbox = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/quality-inbox${qs ? `?${qs}` : ''}`, { auth: true })
}
export const fetchAdminPostQuality = (id) => apiGet(`/api/admin/posts/${id}/quality`, { auth: true })
export const updateAdminPostQualityReview = (id, data) =>
  apiPut(`/api/admin/posts/${id}/quality-review`, data, {
    auth: true,
    invalidatePaths: [`/api/admin/posts/${id}/quality`, '/api/admin/quality-inbox', '/api/posts'],
  })
export const fetchAdminTopicFeedback = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/topic-feedback${qs ? `?${qs}` : ''}`, { auth: true })
}

export const fetchAdminSeries = (requestOptions = {}) =>
  apiGet('/api/admin/series', { ...ADMIN_LIST_CACHE_OPTIONS, ...requestOptions, auth: true })
export const createAdminSeries = (data) => apiPost('/api/admin/series', data, {
  auth: true,
  invalidatePaths: ['/api/admin/series', '/api/series', '/api/home/modules', '/api/search'],
})
export const updateAdminSeries = (id, data) => apiPut(`/api/admin/series/${id}`, data, {
  auth: true,
  invalidatePaths: [`/api/admin/series/${id}`, '/api/admin/series', '/api/series', '/api/home/modules', '/api/search'],
})
export const generateAdminSeriesCover = (id, data = {}) =>
  submitAdminImageGeneration(`/api/admin/series/${id}/generate-cover`, data)
export const fetchAdminCoverGenerationStatus = (requestOptions = {}) =>
  apiGet('/api/admin/cover-generation-status', { ...ADMIN_STATUS_CACHE_OPTIONS, ...requestOptions, auth: true })

export const fetchAdminAiProviderSources = (requestOptions = {}) =>
  apiGet('/api/admin/ai-provider-sources', { ...ADMIN_STATUS_CACHE_OPTIONS, ...requestOptions, auth: true })
export const createAdminAiProviderSource = (data) =>
  apiPost('/api/admin/ai-provider-sources', data, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-provider-sources', '/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const updateAdminAiProviderSource = (id, data) =>
  apiPut(`/api/admin/ai-provider-sources/${id}`, data, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-provider-sources', '/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const deleteAdminAiProviderSource = (id) =>
  apiDelete(`/api/admin/ai-provider-sources/${id}`, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-provider-sources', '/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const fetchAdminAiProviderSourceModels = (id) =>
  apiPost(`/api/admin/ai-provider-sources/${id}/models`, {}, { auth: true })
export const fetchAdminAiModelInstances = (params = {}, requestOptions = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/ai-model-instances${qs ? `?${qs}` : ''}`, { ...ADMIN_STATUS_CACHE_OPTIONS, ...requestOptions, auth: true })
}
export const createAdminAiModelInstance = (data) =>
  apiPost('/api/admin/ai-model-instances', data, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const updateAdminAiModelInstance = (id, data) =>
  apiPut(`/api/admin/ai-model-instances/${id}`, data, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const deleteAdminAiModelInstance = (id) =>
  apiDelete(`/api/admin/ai-model-instances/${id}`, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const updateAdminAiModelOrder = (data) =>
  apiPost('/api/admin/ai-model-instances/order', data, {
    auth: true,
    invalidatePaths: ['/api/admin/ai-model-instances', '/api/admin/ai-runtime-plan', '/api/admin/cover-generation-status'],
  })
export const testAdminAiModelInstance = (id) =>
  apiPost(`/api/admin/ai-model-instances/${id}/test`, {}, { auth: true })
export const fetchAdminAiRuntimePlan = (requestOptions = {}) =>
  apiGet('/api/admin/ai-runtime-plan', { ...ADMIN_STATUS_CACHE_OPTIONS, ...requestOptions, auth: true })

export const fetchAdminTopicProfiles = (requestOptions = {}) =>
  apiGet('/api/admin/topic-profiles', { ...ADMIN_LIST_CACHE_OPTIONS, ...requestOptions, auth: true })
export const createAdminTopicProfile = (data) => apiPost('/api/admin/topic-profiles', data, {
  auth: true,
  invalidatePaths: ['/api/admin/topic-profiles', '/api/topics', '/api/home/modules', '/api/search'],
})
export const updateAdminTopicProfile = (id, data) =>
  apiPut(`/api/admin/topic-profiles/${id}`, data, {
    auth: true,
    invalidatePaths: [`/api/admin/topic-profiles/${id}`, '/api/admin/topic-profiles', '/api/topics', '/api/home/modules', '/api/search'],
  })
export const generateAdminTopicProfileCover = (id, data = {}) =>
  submitAdminImageGeneration(`/api/admin/topic-profiles/${id}/generate-cover`, data)

export const fetchAdminTopicHealth = (params = {}, requestOptions = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/topic-health${qs ? `?${qs}` : ''}`, { ...ADMIN_LIST_CACHE_OPTIONS, ...requestOptions, auth: true })
}
export const fetchAdminSearchInsights = (params = {}, requestOptions = {}) => {
  const qs = new URLSearchParams(params).toString()
  return apiGet(`/api/admin/search-insights${qs ? `?${qs}` : ''}`, { ...ADMIN_LIST_CACHE_OPTIONS, ...requestOptions, auth: true })
}
export const fetchAdminSubscriptionHealth = (requestOptions = {}) =>
  apiGet('/api/admin/subscription-health', { ...ADMIN_STATUS_CACHE_OPTIONS, ...requestOptions, auth: true })

export const upsertAdminPublishingMetadata = (data) =>
  apiPost('/api/admin/publishing-metadata', data, {
    auth: true,
    invalidatePaths: ['/api/admin/publishing-metadata', '/api/home/modules', '/api/topics', '/api/series', '/api/search'],
  })

const HEALTH_CHECK_TIMEOUT = 10000

const HEALTH_TARGETS = [
  { key: 'admin-posts', label: '后台文章列表', path: '/api/admin/posts?page_size=20', kind: 'json', expectedKeys: ['items'], auth: true },
  { key: 'admin-topics', label: '后台主题管理', path: '/api/admin/topic-profiles', kind: 'json', auth: true },
  { key: 'admin-series', label: '后台系列管理', path: '/api/admin/series', kind: 'json', auth: true },
  { key: 'api-health', label: '健康检查', path: '/api/health', kind: 'json', expected: 'ok' },
  { key: 'discover', label: '发现页数据', path: '/api/discover?limit=1', kind: 'json', expectedKeys: ['items'] },
  { key: 'topics', label: '主题列表', path: '/api/topics?limit=1', kind: 'json', expectedKeys: ['items'] },
  { key: 'search', label: '搜索接口', path: '/api/search?q=openai&limit=1', kind: 'json', expectedKeys: ['items'] },
  { key: 'feed-root', label: '全站 RSS', path: '/feed.xml', kind: 'xml', expected: '<rss' },
  { key: 'sitemap', label: '站点地图', path: '/sitemap.xml', kind: 'xml', expected: '<urlset' },
  { key: 'feed-daily', label: '日报 RSS', path: '/api/feeds/daily.xml', kind: 'xml', expected: '<rss' },
  { key: 'feed-weekly', label: '周报 RSS', path: '/api/feeds/weekly.xml', kind: 'xml', expected: '<rss' },
]

function buildHealthResult(target, patch = {}) {
  return {
    ...target,
    ok: false,
    status: 'unknown',
    status_code: null,
    duration_ms: null,
    checked_at: new Date().toISOString(),
    summary: '',
    detail: '',
    ...patch,
  }
}

async function probePublicTarget(target, timeout = HEALTH_CHECK_TIMEOUT) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeout)
  const startedAt = performance.now()
  const headers = {
    Accept: target.kind === 'json' ? 'application/json' : 'application/xml,text/xml,text/plain,*/*',
  }

  if (target.auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  try {
    const response = await fetch(buildApiUrl(target.path), {
      method: 'GET',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    })

    const durationMs = Math.round(performance.now() - startedAt)
    const text = await response.text()

    if (!response.ok) {
      return buildHealthResult(target, {
        status: 'http_error',
        status_code: response.status,
        duration_ms: durationMs,
        summary: `HTTP ${response.status}`,
        detail: text.slice(0, 160) || '接口返回了非成功状态码。',
      })
    }

    if (target.kind === 'json') {
      let parsed = null
      try {
        parsed = text ? JSON.parse(text) : null
      } catch (error) {
        return buildHealthResult(target, {
          status: 'invalid',
          status_code: response.status,
          duration_ms: durationMs,
          summary: '响应不是合法 JSON',
          detail: error.message || 'JSON 解析失败',
        })
      }

      if (target.expected && parsed?.status !== target.expected) {
        return buildHealthResult(target, {
          status: 'invalid',
          status_code: response.status,
          duration_ms: durationMs,
          summary: `缺少预期状态 ${target.expected}`,
          detail: `实际返回 status=${String(parsed?.status ?? '') || '空值'}`,
        })
      }

      if (Array.isArray(target.expectedKeys) && !target.expectedKeys.every((key) => key in (parsed || {}))) {
        return buildHealthResult(target, {
          status: 'invalid',
          status_code: response.status,
          duration_ms: durationMs,
          summary: '响应缺少关键字段',
          detail: `缺少字段：${target.expectedKeys.filter((key) => !(key in (parsed || {}))).join('、')}`,
        })
      }

      return buildHealthResult(target, {
        ok: true,
        status: durationMs > 1500 ? 'slow' : 'ok',
        status_code: response.status,
        duration_ms: durationMs,
        summary: durationMs > 1500 ? '接口可用，但响应偏慢' : '接口可用',
        detail: 'JSON 结构符合预期。',
      })
    }

    if (target.expected && !text.includes(target.expected)) {
      return buildHealthResult(target, {
        status: 'invalid',
        status_code: response.status,
        duration_ms: durationMs,
        summary: '响应内容不符合预期',
        detail: `未检测到 ${target.expected}`,
      })
    }

    return buildHealthResult(target, {
      ok: true,
      status: durationMs > 1500 ? 'slow' : 'ok',
      status_code: response.status,
      duration_ms: durationMs,
      summary: durationMs > 1500 ? '接口可用，但响应偏慢' : '接口可用',
      detail: target.kind === 'xml' ? 'XML 内容结构符合预期。' : '检查通过。',
    })
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt)
    if (error?.name === 'AbortError') {
      return buildHealthResult(target, {
        status: 'timeout',
        duration_ms: durationMs,
        summary: '请求超时',
        detail: `超过 ${Math.round(timeout / 1000)} 秒仍未完成。`,
      })
    }

    return buildHealthResult(target, {
      status: 'network_error',
      duration_ms: durationMs,
      summary: '网络请求失败',
      detail: error?.message || '浏览器侧探测失败',
    })
  } finally {
    window.clearTimeout(timer)
  }
}

export async function probeAdminEndpointHealth() {
  const items = await Promise.all(HEALTH_TARGETS.map((target) => probePublicTarget(target)))
  const okCount = items.filter((item) => item.ok).length
  const slowCount = items.filter((item) => item.status === 'slow').length
  const failedCount = items.length - okCount

  return {
    checked_at: new Date().toISOString(),
    overview: {
      total: items.length,
      ok: okCount,
      slow: slowCount,
      failed: failedCount,
    },
    items,
  }
}
