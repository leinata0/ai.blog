import { apiGet, apiPost } from './client'

function normalizeContentType(contentType) {
  if (contentType === 'daily_brief' || contentType === 'weekly_review') {
    return contentType
  }
  return null
}

function normalizeQualitySnapshot(payload = null) {
  if (!payload || typeof payload !== 'object') return null
  return {
    overall_score: payload.overall_score ?? null,
    structure_score: payload.structure_score ?? null,
    source_score: payload.source_score ?? null,
    analysis_score: payload.analysis_score ?? null,
    packaging_score: payload.packaging_score ?? null,
    resonance_score: payload.resonance_score ?? null,
    issues: Array.isArray(payload.issues) ? payload.issues : [],
    strengths: Array.isArray(payload.strengths) ? payload.strengths : [],
    notes: payload.notes ?? '',
  }
}

function normalizeQualityReview(payload = null) {
  if (!payload || typeof payload !== 'object') return null
  return {
    editor_verdict: payload.editor_verdict ?? '',
    editor_labels: Array.isArray(payload.editor_labels) ? payload.editor_labels : [],
    editor_note: payload.editor_note ?? '',
    followup_recommended: payload.followup_recommended ?? null,
  }
}

function clampScore(value) {
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function buildHeuristicScore(sourceCount, weight) {
  if (!Number.isFinite(Number(sourceCount)) || Number(sourceCount) <= 0) return null
  return Math.max(45, Math.min(95, Math.round(Number(sourceCount) * weight)))
}

function deriveQualityInsights(payload = {}) {
  const snapshot = normalizeQualitySnapshot(payload.quality_snapshot)
  const review = normalizeQualityReview(payload.quality_review)
  const sourceCount = Number(payload.source_count ?? 0)
  const readingTime = Number(payload.reading_time ?? 0)
  const overallScore = clampScore(snapshot?.overall_score ?? payload.quality_score)
  const structureScore = clampScore(snapshot?.structure_score ?? (overallScore !== null ? overallScore + 4 : null))
  const sourceScore = clampScore(snapshot?.source_score ?? buildHeuristicScore(sourceCount, 18))
  const analysisScore = clampScore(
    snapshot?.analysis_score ?? (
      readingTime > 0
        ? Math.min(92, Math.round(48 + readingTime * 6))
        : overallScore !== null
          ? Math.max(52, overallScore - 3)
          : null
    )
  )
  const sameTopicCount = Array.isArray(payload.same_topic_posts) ? payload.same_topic_posts.length : 0
  const hasSourceSummary = Boolean(String(payload.source_summary || '').trim())
  const hasSignal =
    snapshot !== null ||
    overallScore !== null ||
    sourceCount > 0 ||
    readingTime > 0 ||
    hasSourceSummary ||
    sameTopicCount > 0 ||
    Boolean(payload.series_slug)

  if (!hasSignal) return null

  const structureSummary =
    structureScore === null
      ? '暂时缺少结构评分。'
      : structureScore >= 85
        ? '结构区块较完整，阅读路径清晰。'
        : structureScore >= 70
          ? '结构基本稳定，但仍有细节可继续优化。'
          : '结构完整度一般，后续可继续补强章节层次。'

  const sourceSummary =
    sourceScore === null
      ? '当前缺少来源计数信息。'
      : sourceScore >= 85
        ? '来源覆盖较充分，适合继续沿这条主线扩展。'
        : sourceScore >= 70
          ? '来源基础可用，但仍可补充更多高质量视角。'
          : '来源支撑偏薄，后续更适合增加官方或一手信号。'

  const analysisSummary =
    analysisScore === null
      ? '当前缺少分析深度信号。'
      : analysisScore >= 85
        ? '正文具备较好的分析展开空间，不止停留在信息罗列。'
        : analysisScore >= 70
          ? '正文已有一定分析，但仍可继续增强背景和取舍判断。'
          : '正文分析密度偏弱，更适合后续继续补深。'

  const followupRecommended =
    review?.followup_recommended ??
    Boolean((snapshot?.resonance_score ?? 0) >= 55 || sameTopicCount > 0 || (overallScore ?? 0) >= 82 || payload.series_slug)

  const followupSummary = followupRecommended
    ? '这条主线值得继续追踪，后续可以串联同主题和同系列文章。'
    : '这篇内容更适合作为一次性观察点，后续是否追踪取决于新信号。'

  return {
    has_snapshot: Boolean(snapshot),
    overall_score: overallScore,
    structure_score: structureScore,
    source_score: sourceScore,
    analysis_score: analysisScore,
    source_count: sourceCount || null,
    reading_time: readingTime || null,
    structure_summary: structureSummary,
    source_summary: sourceSummary,
    analysis_summary: analysisSummary,
    followup_recommended: followupRecommended,
    followup_summary: followupSummary,
    review_verdict: review?.editor_verdict || '',
    snapshot_notes: snapshot?.notes || '',
  }
}

export function normalizePost(payload = {}) {
  return {
    ...payload,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    content_type: normalizeContentType(payload.content_type),
    topic_key: payload.topic_key ?? '',
    series_slug: payload.series_slug ?? '',
    series_order: payload.series_order ?? null,
    editor_note: payload.editor_note ?? '',
    source_count: payload.source_count ?? 0,
    quality_score: payload.quality_score ?? null,
    reading_time: payload.reading_time ?? null,
    series: payload.series ?? null,
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    source_summary: payload.source_summary ?? '',
    quality_snapshot: normalizeQualitySnapshot(payload.quality_snapshot),
    quality_review: normalizeQualityReview(payload.quality_review),
    same_series_posts: Array.isArray(payload.same_series_posts) ? payload.same_series_posts.map((item) => normalizePost(item)) : [],
    same_topic_posts: Array.isArray(payload.same_topic_posts) ? payload.same_topic_posts.map((item) => normalizePost(item)) : [],
    same_week_posts: Array.isArray(payload.same_week_posts) ? payload.same_week_posts.map((item) => normalizePost(item)) : [],
    published_mode:
      payload.published_mode === 'auto' || payload.published_mode === 'manual'
        ? payload.published_mode
        : null,
    coverage_date: payload.coverage_date ?? null,
    quality_insights: deriveQualityInsights(payload),
  }
}

export function normalizePostList(payload) {
  return {
    items: Array.isArray(payload?.items) ? payload.items.map((item) => normalizePost(item)) : [],
    total: payload.total ?? 0,
    page: payload.page ?? 1,
    page_size: payload.page_size ?? 10,
  }
}

export async function fetchPosts({ tag, q, page = 1, pageSize = 10 } = {}) {
  const params = new URLSearchParams()
  if (tag) params.set('tag', tag)
  if (q) params.set('q', q)
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  const qs = params.toString()
  return normalizePostList(await apiGet(`/api/posts?${qs}`))
}

export async function fetchPostDetail(slug) {
  return normalizePost(await apiGet(`/api/posts/${slug}`))
}

export async function fetchComments(slug) {
  return apiGet(`/api/posts/${slug}/comments`)
}

export async function postComment(slug, nickname, content) {
  return apiPost(`/api/posts/${slug}/comments`, { nickname, content })
}

export async function fetchArchive() {
  const groups = await apiGet('/api/archive')
  if (!Array.isArray(groups)) return []
  return groups.map((group) => ({
    ...group,
    posts: Array.isArray(group.posts) ? group.posts.map((post) => normalizePost(post)) : [],
  }))
}

export async function fetchAllTags() {
  return apiGet('/api/tags')
}

export const likePost = (slug) => apiPost(`/api/posts/${slug}/like`)
export const fetchRelatedPosts = async (slug) => {
  const posts = await apiGet(`/api/posts/${slug}/related`)
  return Array.isArray(posts) ? posts.map((post) => normalizePost(post)) : []
}
export const fetchFriendLinks = () => apiGet('/api/friends')

function normalizeSeries(payload = {}) {
  return {
    ...payload,
    slug: payload.slug ?? '',
    title: payload.title ?? '',
    description: payload.description ?? '',
    cover_image: payload.cover_image ?? '',
    is_featured: Boolean(payload.is_featured),
    sort_order: payload.sort_order ?? 0,
    content_types: Array.isArray(payload.content_types) ? payload.content_types : [],
    post_count: payload.post_count ?? 0,
    latest_posts: Array.isArray(payload.latest_posts) ? payload.latest_posts.map((post) => normalizePost(post)) : [],
    posts: Array.isArray(payload.posts) ? payload.posts.map((post) => normalizePost(post)) : [],
  }
}

function normalizeTopic(payload = {}) {
  const topicPosts = Array.isArray(payload.posts)
    ? payload.posts
    : Array.isArray(payload.timeline)
      ? payload.timeline
      : Array.isArray(payload.recent_posts)
        ? payload.recent_posts
        : []
  return {
    topic_key: payload.topic_key ?? '',
    display_title: payload.display_title ?? payload.title ?? payload.topic_key ?? '',
    description: payload.description ?? '',
    cover_image: payload.cover_image ?? '',
    aliases: Array.isArray(payload.aliases) ? payload.aliases : Array.isArray(payload.aliases_json) ? payload.aliases_json : [],
    is_featured: Boolean(payload.is_featured),
    sort_order: payload.sort_order ?? 0,
    latest_post_at: payload.latest_post_at ?? null,
    post_count: payload.post_count ?? 0,
    source_count: payload.source_count ?? 0,
    avg_quality_score: payload.avg_quality_score ?? null,
    followup_recommended: payload.followup_recommended ?? null,
    posts: topicPosts.map((post) => normalizePost(post)),
    related_series: Array.isArray(payload.related_series) ? payload.related_series.map((series) => normalizeSeries(series)) : [],
    timeline: topicPosts.map((post) => normalizePost(post)),
    quality_summary: payload.quality_summary ?? null,
  }
}

function buildQuery(params = {}) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    qs.set(key, String(value))
  })
  const query = qs.toString()
  return query ? `?${query}` : ''
}

export async function fetchSeriesList(params = {}) {
  const payload = await apiGet(`/api/series${buildQuery(params)}`)
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
  const normalized = items.map((series) => normalizeSeries(series))
  if (params.featured) {
    return normalized.filter((series) => series.is_featured)
  }
  return normalized
}

export async function fetchSeriesDetail(slug) {
  return normalizeSeries(await apiGet(`/api/series/${slug}`))
}

export async function fetchDiscover(params = {}) {
  const payload = await apiGet(`/api/discover${buildQuery(params)}`)
  if (Array.isArray(payload)) {
    return { items: payload.map((post) => normalizePost(post)), total: payload.length }
  }
  const groupedFallback = [
    ...(Array.isArray(payload?.editor_picks) ? payload.editor_picks : []),
    ...(Array.isArray(payload?.latest_weekly) ? payload.latest_weekly : []),
    ...(Array.isArray(payload?.latest_daily) ? payload.latest_daily : []),
  ]
  const itemSource = Array.isArray(payload?.items) && payload.items.length > 0 ? payload.items : groupedFallback
  return {
    ...payload,
    featured_series: Array.isArray(payload?.featured_series) ? payload.featured_series.map((series) => normalizeSeries(series)) : [],
    latest_daily: Array.isArray(payload?.latest_daily) ? payload.latest_daily.map((post) => normalizePost(post)) : [],
    latest_weekly: Array.isArray(payload?.latest_weekly) ? payload.latest_weekly.map((post) => normalizePost(post)) : [],
    editor_picks: Array.isArray(payload?.editor_picks) ? payload.editor_picks.map((post) => normalizePost(post)) : [],
    items: itemSource.map((post) => normalizePost(post)),
    total: payload?.total ?? itemSource.length,
    facets: payload?.facets ?? {},
  }
}

export async function fetchSearch(params = {}) {
  const payload = await apiGet(`/api/search${buildQuery(params)}`)
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
  return {
    ...payload,
    items: items.map((post) => normalizePost(post)),
    total: payload?.total ?? items.length,
    page: payload?.page ?? 1,
    page_size: payload?.page_size ?? items.length,
    topics: Array.isArray(payload?.topics) ? payload.topics.map((topic) => normalizeTopic(topic)) : [],
    facets: payload?.facets ?? {},
  }
}

export async function fetchTopics(params = {}) {
  const payload = await apiGet(`/api/topics${buildQuery(params)}`)
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
  return {
    ...payload,
    items: items.map((topic) => normalizeTopic(topic)),
    total: payload?.total ?? items.length,
  }
}

export async function fetchTopicDetail(topicKey) {
  return normalizeTopic(await apiGet(`/api/topics/${encodeURIComponent(topicKey)}`))
}
