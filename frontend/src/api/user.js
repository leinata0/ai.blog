import { apiGet, apiPost, apiPut, apiDelete } from './client'

// All visitor-account calls use `auth: 'user'` so client.js injects the
// visitor token and handles 401 without redirecting to the admin login.

// ── Authentication ──
export function registerUser({ email, password, nickname }) {
  return apiPost('/api/users/register', { email, password, nickname })
}

export function loginUser({ email, password }) {
  return apiPost('/api/users/login', { email, password })
}

export function fetchMe() {
  return apiGet('/api/users/me', { auth: 'user', cache: false })
}

export function updateMe({ nickname, avatar_url }) {
  return apiPut('/api/users/me', { nickname, avatar_url }, { auth: 'user' })
}

export function changePassword({ old_password, new_password }) {
  return apiPost('/api/users/me/password', { old_password, new_password }, { auth: 'user' })
}

// ── Followed topics (cloud) ──
export function fetchCloudTopics() {
  return apiGet('/api/users/me/topics', { auth: 'user', cache: false })
}

export function followTopicCloud({ topic_key, display_title }) {
  return apiPost('/api/users/me/topics', { topic_key, display_title }, { auth: 'user' })
}

export function unfollowTopicCloud(topicKey) {
  return apiDelete(`/api/users/me/topics/${encodeURIComponent(topicKey)}`, { auth: 'user' })
}

export function mergeTopicsCloud(topics) {
  return apiPost('/api/users/me/topics/merge', { topics }, { auth: 'user' })
}

// ── Reading history (cloud) ──
export function fetchCloudHistory() {
  return apiGet('/api/users/me/history', { auth: 'user', cache: false })
}

export function recordHistoryCloud(entry) {
  return apiPost('/api/users/me/history', entry, { auth: 'user' })
}

export function mergeHistoryCloud(items) {
  return apiPost('/api/users/me/history/merge', { items }, { auth: 'user' })
}
