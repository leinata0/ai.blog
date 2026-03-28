import { apiGet } from './client'

export function normalizePostList(payload) {
  return payload.items ?? []
}

export async function fetchPosts(tag) {
  const q = tag ? `?tag=${encodeURIComponent(tag)}` : ''
  return normalizePostList(await apiGet(`/api/posts${q}`))
}

export async function fetchPostDetail(slug) {
  return apiGet(`/api/posts/${slug}`)
}
