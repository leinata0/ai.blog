import { apiGet, apiPost } from './client'

export function normalizePostList(payload) {
  return {
    items: payload.items ?? [],
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
  return apiGet(`/api/posts/${slug}`)
}

export async function fetchComments(slug) {
  return apiGet(`/api/posts/${slug}/comments`)
}

export async function postComment(slug, nickname, content) {
  return apiPost(`/api/posts/${slug}/comments`, { nickname, content })
}

export async function fetchArchive() {
  return apiGet('/api/archive')
}

export async function fetchAllTags() {
  return apiGet('/api/tags')
}
