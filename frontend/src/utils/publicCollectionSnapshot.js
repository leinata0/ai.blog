// Shared by prerendering and the browser. Only public list summaries belong here.
export const COLLECTION_SCHEMA_VERSION = 1
export const COLLECTION_ITEM_LIMIT = 24
export const COLLECTION_SNAPSHOT_MAX_BYTES = 128 * 1024
export const COLLECTION_ROUTES = ['/daily', '/weekly', '/topics', '/series']

const text = (value, limit = 1200) => typeof value === 'string' ? value.slice(0, limit) : ''
const count = (value) => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
const isPublic = (item) => item && typeof item === 'object' && item.is_published !== false && !['draft', 'private', 'archived', 'unpublished'].includes(item.status)

function postSummary(item) {
  if (!isPublic(item) || !text(item.slug, 200).trim() || !text(item.title, 300).trim()) return null
  return {
    slug: text(item.slug, 200), title: text(item.title, 300), summary: text(item.summary),
    cover_image: text(item.cover_image, 2048), created_at: text(item.created_at, 60),
    coverage_date: text(item.coverage_date, 60) || null,
    content_type: ['daily_brief', 'weekly_review'].includes(item.content_type) ? item.content_type : null,
    source_count: count(item.source_count) ?? 0, reading_time: count(item.reading_time),
    topic_key: text(item.topic_key, 200), series_slug: text(item.series_slug, 200),
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string').slice(0, 8).map((tag) => text(tag, 80)) : [],
  }
}

function topicSummary(item) {
  if (!isPublic(item)) return null
  const profile = item.profile && typeof item.profile === 'object' ? item.profile : {}
  const key = text(item.topic_key || profile.topic_key, 200)
  if (!key.trim()) return null
  return {
    topic_key: key,
    display_title: text(item.display_title || profile.display_title || item.title || profile.title || key, 300),
    title: text(item.title || profile.title, 300), description: text(item.description || profile.description),
    cover_image: text(item.cover_image || profile.cover_image, 2048),
    is_featured: Boolean(item.is_featured ?? profile.is_featured),
    post_count: count(item.post_count) ?? 0, source_count: count(item.source_count) ?? 0,
    latest_post_at: text(item.latest_post_at || profile.latest_post_at, 60) || null,
    aliases: (Array.isArray(item.aliases) ? item.aliases : []).filter((alias) => typeof alias === 'string').slice(0, 8).map((alias) => text(alias, 100)),
  }
}

function seriesSummary(item) {
  if (!isPublic(item) || !text(item.slug, 200).trim()) return null
  return {
    slug: text(item.slug, 200), title: text(item.title, 300), description: text(item.description),
    cover_image: text(item.cover_image, 2048), is_featured: Boolean(item.is_featured),
    post_count: count(item.post_count) ?? 0, latest_post_at: text(item.latest_post_at, 60) || null,
    latest_posts: (Array.isArray(item.latest_posts) ? item.latest_posts : []).map(postSummary).filter(Boolean).slice(0, 3),
    content_types: (Array.isArray(item.content_types) ? item.content_types : []).filter((type) => ['daily_brief', 'weekly_review'].includes(type)),
  }
}

export function createCollectionSnapshot(route, items, generatedAt = new Date().toISOString()) {
  if (!COLLECTION_ROUTES.includes(route) || !Array.isArray(items)) return null
  const mapper = route === '/topics' ? topicSummary : route === '/series' ? seriesSummary : postSummary
  const seen = new Set()
  const summaries = []
  for (const raw of items) {
    const item = mapper(raw)
    if (!item) continue
    if (route === '/daily' && item.content_type && item.content_type !== 'daily_brief') continue
    if (route === '/weekly' && item.content_type && item.content_type !== 'weekly_review') continue
    const key = route === '/topics' ? item.topic_key : item.slug
    if (seen.has(key)) continue
    seen.add(key)
    summaries.push(item)
    if (summaries.length === COLLECTION_ITEM_LIMIT) break
  }
  return { schemaVersion: COLLECTION_SCHEMA_VERSION, generatedAt, route, items: summaries }
}

export function serializeCollectionSnapshot(snapshot) {
  if (!snapshot) return ''
  const serialized = JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return new TextEncoder().encode(serialized).byteLength <= COLLECTION_SNAPSHOT_MAX_BYTES ? serialized : ''
}
