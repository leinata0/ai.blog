const API_BASE = String(import.meta.env.VITE_API_BASE || '').trim().replace(/\/$/, '')

export function buildPublicApiUrl(path = '') {
  const normalizedPath = String(path || '')
  if (!API_BASE) return normalizedPath
  if (!normalizedPath) return API_BASE
  return `${API_BASE}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}
