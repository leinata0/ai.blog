import { COLLECTION_SCHEMA_VERSION, COLLECTION_SNAPSHOT_MAX_BYTES, createCollectionSnapshot, postSummary } from './publicCollectionSnapshot.js'

export const PUBLIC_HOME_SNAPSHOT_MAX_BYTES = COLLECTION_SNAPSHOT_MAX_BYTES
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : ''
const settingLimits = {
  author_name: 300, bio: 1200, avatar_url: 2048, hero_image: 2048,
  github_link: 2048, announcement: 1200, site_url: 2048, friend_links: 12000,
}

function homePost(item) {
  const summary = postSummary(item)
  if (!summary || (item.tags != null && !Array.isArray(item.tags))) return null
  const tags = []
  for (const tag of (item.tags || []).slice(0, 8)) {
    if (typeof tag === 'string' && tag.trim()) tags.push({ name: text(tag, 80), slug: text(tag, 200) })
    else if (object(tag) && typeof tag.name === 'string' && tag.name.trim() && typeof tag.slug === 'string' && tag.slug.trim()) {
      tags.push({ name: text(tag.name, 80), slug: text(tag.slug, 200) })
    } else return null
  }
  return { ...summary, is_pinned: item.is_pinned === true, tags }
}

function mapItems(items, limit, mapper) {
  const mapped = items.slice(0, limit).map(mapper)
  return mapped.some((item) => !item) ? null : mapped
}

/** Complete public home data only. Missing sections must not become fake empties. */
export function createPublicHomeSnapshot(raw, generatedAt = raw?.generatedAt ?? new Date().toISOString()) {
  if (!object(raw) || !object(raw.settings) || !object(raw.posts) || !object(raw.home_modules)
    || !Array.isArray(raw.posts.items) || !Array.isArray(raw.home_modules.latest_weekly)
    || !Array.isArray(raw.home_modules.featured_series) || !Array.isArray(raw.home_topics)
    || !Number.isSafeInteger(raw.posts.total) || raw.posts.total < 0
    || (raw.posts.page !== undefined && raw.posts.page !== 1)
    || (raw.posts.page_size !== undefined && raw.posts.page_size !== 10)
    || typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) return null

  const settings = {}
  for (const [key, limit] of Object.entries(settingLimits)) {
    if (raw.settings[key] != null && typeof raw.settings[key] !== 'string') return null
    settings[key] = raw.settings[key] == null ? (key === 'friend_links' ? '[]' : '') : text(raw.settings[key], limit)
  }
  const posts = mapItems(raw.posts.items, 10, homePost)
  const weekly = mapItems(raw.home_modules.latest_weekly, 3, (item) => {
    const summary = homePost(item)
    return summary && (!summary.content_type || summary.content_type === 'weekly_review') ? summary : null
  })
  const series = mapItems(raw.home_modules.featured_series, 2, (item) => createCollectionSnapshot('/series', [item], generatedAt)?.items[0])
  const topics = mapItems(raw.home_topics, 4, (item) => createCollectionSnapshot('/topics', [item], generatedAt)?.items[0])
  if (!posts || !weekly || !series || !topics) return null
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION, route: '/', generatedAt,
    settings, posts: { items: posts, total: raw.posts.total, page: 1, page_size: 10 },
    home_modules: { latest_weekly: weekly, featured_series: series }, home_topics: topics,
  }
}

export function serializePublicHomeSnapshot(snapshot) {
  if (snapshot?.schemaVersion !== COLLECTION_SCHEMA_VERSION || snapshot?.route !== '/') return ''
  const safe = createPublicHomeSnapshot(snapshot, snapshot.generatedAt)
  if (!safe) return ''
  const serialized = JSON.stringify(safe).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return new TextEncoder().encode(serialized).byteLength <= PUBLIC_HOME_SNAPSHOT_MAX_BYTES ? serialized : ''
}
