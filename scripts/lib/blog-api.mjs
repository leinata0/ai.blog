const DEFAULT_LOCAL_API_BASE = 'http://127.0.0.1:8000'

export function resolveBlogApiBase(defaultBase = DEFAULT_LOCAL_API_BASE) {
  const value = String(process.env.BLOG_API_BASE || defaultBase || '')
    .trim()
    .replace(/\/$/, '')

  if (!value) {
    throw new Error('BLOG_API_BASE is required.')
  }

  return value
}

export function resolveAdminUsername(defaultUsername = 'admin') {
  return String(process.env.ADMIN_USERNAME || process.env.DEV_ADMIN_USERNAME || defaultUsername).trim() || defaultUsername
}

export function resolveAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || process.env.DEV_ADMIN_PASSWORD || '').trim()
}
