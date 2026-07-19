import { apiGet, apiPost, apiPut, apiDelete } from './client'

// All visitor-account calls use `auth: 'user'` so client.js injects the
// visitor token and handles 401 without redirecting to the admin login.

// ── Authentication ──
export function registerUser({ email, password, nickname, turnstile_token }) {
  return apiPost('/api/users/register', { email, password, nickname, turnstile_token })
}

export function loginUser({ email, password, turnstile_token }) {
  return apiPost('/api/users/login', { email, password, turnstile_token })
}

export function requestLoginCode({ email, turnstile_token }) {
  return apiPost('/api/users/login-code/request', { email, turnstile_token })
}

export function verifyLoginCode({ email, challenge_id, code, turnstile_token }) {
  return apiPost('/api/users/login-code/verify', { email, challenge_id, code, turnstile_token })
}

export function requestPasswordReset({ email, turnstile_token }) {
  return apiPost('/api/users/password-reset/request', { email, turnstile_token })
}

export function confirmPasswordReset({ email, challenge_id, code, new_password, turnstile_token }) {
  return apiPost(
    '/api/users/password-reset/confirm',
    { email, challenge_id, code, new_password, turnstile_token },
  )
}

export function fetchMe() {
  return apiGet('/api/users/me', { auth: 'user', cache: false })
}

export function updateMe({ nickname, avatar_url, bio }) {
  return apiPut('/api/users/me', { nickname, avatar_url, bio }, { auth: 'user' })
}

export function changePassword({ old_password, new_password }) {
  return apiPost('/api/users/me/password', { old_password, new_password }, { auth: 'user' })
}

export function revokeSessions() {
  return apiPost('/api/users/me/revoke-sessions', undefined, { auth: 'user' })
}

// ── Email verification ──
export function verifyEmail(token) {
  return apiPost('/api/users/verify-email', { token })
}

export function resendVerification() {
  return apiPost('/api/users/resend-verification', undefined, { auth: 'user' })
}

// ── Avatar / account management ──
export function uploadAvatar(file) {
  const formData = new FormData()
  formData.append('file', file)
  return apiPost('/api/users/me/avatar', formData, { auth: 'user' })
}

export function fetchMyComments() {
  return apiGet('/api/users/me/comments', { auth: 'user', cache: false })
}

export function fetchMyLikes() {
  return apiGet('/api/users/me/likes', { auth: 'user', cache: false })
}

export function deleteAccount() {
  return apiDelete('/api/users/me', { auth: 'user' })
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
