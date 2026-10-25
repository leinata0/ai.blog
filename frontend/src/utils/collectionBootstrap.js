import { PERFORMANCE_TRIAL_ENABLED } from './performanceTrial'
import { COLLECTION_ROUTES, COLLECTION_SCHEMA_VERSION, COLLECTION_SNAPSHOT_MAX_BYTES, createCollectionSnapshot, serializeCollectionSnapshot } from './publicCollectionSnapshot'

export const COLLECTION_CACHE_PREFIX = 'blog.collection-trial:'
export const COLLECTION_SESSION_MAX_AGE_MS = 5 * 60 * 1000
export const COLLECTION_BUILD_MAX_AGE_MS = 30 * 60 * 1000
const supersededBuildSnapshots = new WeakSet()

function validateSnapshot(payload, route, maxAge, now) {
  if (!payload || payload.schemaVersion !== COLLECTION_SCHEMA_VERSION || payload.route !== route || !Array.isArray(payload.items)) return null
  const generatedAt = Date.parse(payload.generatedAt)
  if (!Number.isFinite(generatedAt) || generatedAt > now + 60000 || now - generatedAt >= maxAge) return null
  const snapshot = createCollectionSnapshot(route, payload.items, payload.generatedAt)
  if (!serializeCollectionSnapshot(snapshot)) return null
  return { ...snapshot, expiresAt: generatedAt + maxAge }
}

export function readCollectionBootstrap(route, now = Date.now()) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined' || !COLLECTION_ROUTES.includes(route)) return null
  const candidates = []
  let sessionGeneratedAt = 0
  try {
    const raw = window.sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}${route}`)
    if (raw && raw.length <= COLLECTION_SNAPSHOT_MAX_BYTES) {
      const payload = JSON.parse(raw)
      if (payload?.schemaVersion === COLLECTION_SCHEMA_VERSION && payload.route === route) sessionGeneratedAt = Date.parse(payload.generatedAt) || 0
      const saved = validateSnapshot(payload, route, COLLECTION_SESSION_MAX_AGE_MS, now)
      if (saved) candidates.push(saved)
    }
  } catch { /* Storage may be unavailable or contain an interrupted write. */ }
  const rawBuilt = window.__BLOG_COLLECTION_BOOTSTRAP__
  const built = rawBuilt && !supersededBuildSnapshots.has(rawBuilt) && sessionGeneratedAt < Date.parse(rawBuilt.generatedAt)
    ? validateSnapshot(rawBuilt, route, COLLECTION_BUILD_MAX_AGE_MS, now)
    : null
  if (built) candidates.push(built)
  return candidates.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null
}

export function saveCollectionSnapshot(route, items, now = Date.now()) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined') return null
  const snapshot = createCollectionSnapshot(route, items, new Date(now).toISOString())
  const serialized = serializeCollectionSnapshot(snapshot)
  if (!serialized) return null
  const built = window.__BLOG_COLLECTION_BOOTSTRAP__
  if (built && typeof built === 'object' && built.route === route) supersededBuildSnapshots.add(built)
  try { window.sessionStorage.setItem(`${COLLECTION_CACHE_PREFIX}${route}`, serialized) } catch { /* Best-effort cache only. */ }
  return { ...snapshot, expiresAt: now + COLLECTION_SESSION_MAX_AGE_MS }
}
