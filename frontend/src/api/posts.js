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
