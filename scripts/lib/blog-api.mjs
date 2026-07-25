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

export async function fetchAdminPostsByOffset({
  blogApiBase,
  token,
  limit = 50,
  offset = 0,
  fetchImpl = fetch,
  timeoutMs = 15000,
} = {}) {
  const base = String(blogApiBase || '').trim().replace(/\/$/, '')
  if (!base) throw new Error('BLOG_API_BASE is required.')
  if (!token) throw new Error('Admin token is required.')

  const requestedLimit = Math.max(1, Math.floor(Number(limit) || 50))
  const requestedOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const pageSize = Math.min(50, requestedLimit)
  let page = Math.floor(requestedOffset / pageSize) + 1
  let leadingSkip = requestedOffset % pageSize
  const results = []

  while (results.length < requestedLimit) {
    const response = await fetchImpl(
      `${base}/api/admin/posts?page=${page}&page_size=${pageSize}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
    if (!response.ok) {
      throw new Error(`Fetch posts failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
    }

    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    const available = items.slice(leadingSkip)
    results.push(...available.slice(0, requestedLimit - results.length))

    const total = Number(data?.total)
    const reachedKnownEnd = Number.isFinite(total) && page * pageSize >= total
    if (items.length < pageSize || reachedKnownEnd) break

    page += 1
    leadingSkip = 0
  }

  return results
}

export async function findAdminPostByExactSlug({
  blogApiBase,
  token,
  slug,
  fetchImpl = fetch,
  pageSize = 50,
  maxPages = 20,
} = {}) {
  const targetSlug = String(slug || '').trim()
  if (!targetSlug) return null

  for (let page = 0; page < maxPages; page += 1) {
    const items = await fetchAdminPostsByOffset({
      blogApiBase,
      token,
      limit: pageSize,
      offset: page * pageSize,
      fetchImpl,
    })
    const match = items.find((item) => String(item?.slug || '') === targetSlug)
    if (match) return match
    if (items.length < pageSize) break
  }

  return null
}
