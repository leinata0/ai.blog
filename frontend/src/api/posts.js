import { apiGet, apiPost } from './client'

function normalizeContentType(contentType) {
  if (contentType === 'daily_brief' || contentType === 'weekly_review') {
    return contentType
  }
  return null
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
    same_series_posts: Array.isArray(payload.same_series_posts) ? payload.same_series_posts.map((item) => normalizePost(item)) : [],
    same_topic_posts: Array.isArray(payload.same_topic_posts) ? payload.same_topic_posts.map((item) => normalizePost(item)) : [],
    same_week_posts: Array.isArray(payload.same_week_posts) ? payload.same_week_posts.map((item) => normalizePost(item)) : [],
    published_mode:
      payload.published_mode === 'auto' || payload.published_mode === 'manual'
        ? payload.published_mode
        : null,
    coverage_date: payload.coverage_date ?? null,
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
