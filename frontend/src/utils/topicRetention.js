export const FOLLOWED_TOPICS_KEY = 'blog.followed_topics'
export const READING_HISTORY_KEY = 'blog.reading_history'
export const MAX_FOLLOWED_TOPICS = 50
export const MAX_READING_HISTORY = 100

function canUseStorage() {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readJson(key, fallback = []) {
  if (!canUseStorage()) return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  if (!canUseStorage()) return
  window.localStorage.setItem(key, JSON.stringify(value))
}

function normalizeTopic(topic = {}) {
  return {
    topic_key: String(topic.topic_key || '').trim(),
    display_title: String(topic.display_title || topic.title || topic.topic_key || '').trim(),
    description: String(topic.description || '').trim(),
    latest_post_at: topic.latest_post_at || null,
    followed_at: topic.followed_at || new Date().toISOString(),
  }
}

function normalizeHistoryEntry(entry = {}) {
  return {
    slug: String(entry.slug || '').trim(),
    title: String(entry.title || '').trim(),
    summary: String(entry.summary || '').trim(),
    topic_key: String(entry.topic_key || '').trim(),
    content_type: String(entry.content_type || '').trim(),
    coverage_date: String(entry.coverage_date || '').trim(),
    visited_at: entry.visited_at || new Date().toISOString(),
  }
}

export function getFollowedTopics() {
  return readJson(FOLLOWED_TOPICS_KEY).map(normalizeTopic).filter((item) => item.topic_key)
}

export function isTopicFollowed(topicKey) {
  const normalized = String(topicKey || '').trim()
  if (!normalized) return false
  return getFollowedTopics().some((topic) => topic.topic_key === normalized)
}

export function setFollowedTopics(items) {
  const unique = []
  const seen = new Set()
  for (const item of items) {
    const normalized = normalizeTopic(item)
    if (!normalized.topic_key || seen.has(normalized.topic_key)) continue
    seen.add(normalized.topic_key)
    unique.push(normalized)
  }
  const limited = unique.slice(0, MAX_FOLLOWED_TOPICS)
  writeJson(FOLLOWED_TOPICS_KEY, limited)
  return limited
}

export function toggleFollowedTopic(topic) {
  const normalized = normalizeTopic(topic)
  if (!normalized.topic_key) return getFollowedTopics()
  const current = getFollowedTopics()
  if (current.some((item) => item.topic_key === normalized.topic_key)) {
    return setFollowedTopics(current.filter((item) => item.topic_key !== normalized.topic_key))
  }
  return setFollowedTopics([{ ...normalized, followed_at: new Date().toISOString() }, ...current])
}

export function getReadingHistory() {
  return readJson(READING_HISTORY_KEY).map(normalizeHistoryEntry).filter((item) => item.slug)
}

export function recordReadingHistory(post = {}) {
  const entry = normalizeHistoryEntry(post)
  if (!entry.slug) return getReadingHistory()
  const next = [entry, ...getReadingHistory().filter((item) => item.slug !== entry.slug)]
  const limited = next.slice(0, MAX_READING_HISTORY)
  writeJson(READING_HISTORY_KEY, limited)
  return limited
}

export function getContinueReadingItems(limit = 6) {
  return getReadingHistory().slice(0, limit)
}

export function getRecentTopics(limit = 6) {
  const seen = new Set()
  const topics = []
  for (const item of getReadingHistory()) {
    if (!item.topic_key || seen.has(item.topic_key)) continue
    seen.add(item.topic_key)
    topics.push({
      topic_key: item.topic_key,
      display_title: item.topic_key,
      latest_post_at: item.visited_at,
    })
    if (topics.length >= limit) break
  }
  return topics
}
