import { PERFORMANCE_TRIAL_ENABLED } from './performanceTrial'
import { COLLECTION_ROUTES, COLLECTION_SCHEMA_VERSION, COLLECTION_SNAPSHOT_MAX_BYTES, createCollectionSnapshot, serializeCollectionSnapshot } from './publicCollectionSnapshot'

export const COLLECTION_CACHE_PREFIX = 'blog.collection-trial:'
export const COLLECTION_WATERMARK_PREFIX = 'blog.collection-trial:watermark:'
export const COLLECTION_SESSION_MAX_AGE_MS = 5 * 60 * 1000
export const COLLECTION_BUILD_MAX_AGE_MS = 30 * 60 * 1000
export const COLLECTION_REFRESH_TIMEOUT_MS = 8000
const supersededBuildSnapshots = new WeakSet()
// Only the four allowlisted routes can enter this map. It also preserves the
// latest verification when storage is unavailable or a quota write fails.
const verifiedSnapshots = new Map()

function normalizeSnapshot(payload, route, now) {
  if (!payload || payload.schemaVersion !== COLLECTION_SCHEMA_VERSION || payload.route !== route || !Array.isArray(payload.items)) return null
  const generatedAt = Date.parse(payload.generatedAt)
  if (!Number.isFinite(generatedAt) || generatedAt > now + 60000) return null
  const snapshot = createCollectionSnapshot(route, payload.items, payload.generatedAt)
  return serializeCollectionSnapshot(snapshot) ? snapshot : null
}

function buildSnapshots(route) {
  return [window.__BLOG_COLLECTION_BOOTSTRAP__, window.__BLOG_COLLECTION_BOOTSTRAPS__?.[route]]
}

function readVerification(route, now) {
  let memory = verifiedSnapshots.get(route)
  if (memory && Date.parse(memory.snapshot.generatedAt) > now + 60000) memory = null
  let stored = null
  let watermark = null
  let storageUnavailable = false
  try {
    const raw = window.sessionStorage.getItem(`${COLLECTION_CACHE_PREFIX}${route}`)
    const rawMark = window.sessionStorage.getItem(`${COLLECTION_WATERMARK_PREFIX}${route}`)
    // An explicit storage clear drops its readable cache, while the WeakSet
    // still prevents this document's already-superseded build from returning.
    if (!raw && !rawMark && !memory?.storageFailed) {
      verifiedSnapshots.delete(route)
      memory = null
    }
    if (raw && raw.length <= COLLECTION_SNAPSHOT_MAX_BYTES) {
      try { stored = normalizeSnapshot(JSON.parse(raw), route, now) } catch { /* Interrupted write. */ }
    }
    if (rawMark && rawMark.length < 2048) {
      try {
        const mark = JSON.parse(rawMark)
        const generatedAt = Date.parse(mark.generatedAt)
        if (mark.schemaVersion === COLLECTION_SCHEMA_VERSION && mark.route === route
          && Number.isFinite(generatedAt) && generatedAt <= now + 60000) {
          watermark = {
            generatedAt, empty: mark.empty === true,
            supersededBuildAt: Number.isFinite(mark.supersededBuildAt) && mark.supersededBuildAt <= now + 60000 ? mark.supersededBuildAt : 0,
          }
        }
      } catch { /* Invalid verification metadata never grants freshness. */ }
    }
  } catch { storageUnavailable = true }
  if (stored && watermark?.empty && Date.parse(stored.generatedAt) === watermark.generatedAt && stored.items.length) stored = null
  const generatedAt = Math.max(watermark?.generatedAt ?? -Infinity, stored ? Date.parse(stored.generatedAt) : -Infinity, memory ? Date.parse(memory.snapshot.generatedAt) : -Infinity)
  const known = [stored, memory?.snapshot].filter((snapshot) => snapshot && Date.parse(snapshot.generatedAt) === generatedAt)
    .sort((a, b) => a.items.length - b.items.length)[0] || null
  const snapshot = stored && Date.parse(stored.generatedAt) === generatedAt ? stored
    : storageUnavailable || memory?.storageFailed ? known : null
  return {
    generatedAt, snapshot, known, empty: known?.items.length === 0 || (watermark?.generatedAt === generatedAt && watermark.empty),
    supersededBuildAt: Math.max(watermark?.supersededBuildAt || 0, memory?.supersededBuildAt || 0),
  }
}

function validateSnapshot(payload, route, maxAge, now, source, allowPreview) {
  const snapshot = normalizeSnapshot(payload, route, now)
  if (!snapshot) return null
  const generatedAt = Date.parse(snapshot.generatedAt)
  const expired = now - generatedAt >= maxAge
  // An explicitly dated preview can bridge the short verification request. It
  // never becomes fresh data or survives a failed/timed-out verification.
  if (expired && (!allowPreview || !snapshot.items.length)) return null
  return { ...snapshot, source, preview: expired, expiresAt: expired ? now + COLLECTION_REFRESH_TIMEOUT_MS : generatedAt + maxAge }
}

export function readCollectionBootstrap(route, now = Date.now(), { allowPreview = false } = {}) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined' || !COLLECTION_ROUTES.includes(route)) return null
  const candidates = []
  const verification = readVerification(route, now)
  const saved = validateSnapshot(verification.snapshot, route, COLLECTION_SESSION_MAX_AGE_MS, now, 'session', allowPreview)
  if (saved) candidates.push(saved)
  for (const rawBuilt of buildSnapshots(route)) {
    const builtAt = Date.parse(rawBuilt?.generatedAt)
    const built = rawBuilt && !supersededBuildSnapshots.has(rawBuilt)
      && verification.generatedAt < builtAt && verification.supersededBuildAt < builtAt
      ? validateSnapshot(rawBuilt, route, COLLECTION_BUILD_MAX_AGE_MS, now, 'build', allowPreview)
      : null
    if (built) candidates.push(built)
  }
  return candidates.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null
}

export function saveCollectionSnapshot(route, items, generatedAt = Date.now()) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined' || !COLLECTION_ROUTES.includes(route) || !Number.isFinite(generatedAt)) return null
  const now = Date.now()
  const snapshot = normalizeSnapshot(createCollectionSnapshot(route, items, new Date(generatedAt).toISOString()), route, now)
  if (!snapshot) return null
  const serialized = serializeCollectionSnapshot(snapshot)
  if (!serialized) return null
  const verification = readVerification(route, now)
  // Do not let a different edge location's older response revive a withdrawn
  // article. At an identical source timestamp, an already-empty result wins.
  if (generatedAt < verification.generatedAt
    || (generatedAt === verification.generatedAt && verification.empty && snapshot.items.length > 0)) {
    return validateSnapshot(verification.known, route, COLLECTION_SESSION_MAX_AGE_MS, now, 'session', false)
  }
  let supersededBuildAt = verification.supersededBuildAt
  for (const built of buildSnapshots(route)) {
    if (built && normalizeSnapshot(built, route, now)) {
      supersededBuildSnapshots.add(built)
      supersededBuildAt = Math.max(supersededBuildAt, Date.parse(built.generatedAt))
    }
  }
  const memory = { snapshot, supersededBuildAt, storageFailed: false }
  verifiedSnapshots.set(route, memory)
  try {
    // Write the small watermark first: even an interrupted/quota-failed body
    // write must not expose an older build or body after a document reload.
    window.sessionStorage.setItem(`${COLLECTION_WATERMARK_PREFIX}${route}`, JSON.stringify({
      schemaVersion: COLLECTION_SCHEMA_VERSION, route, generatedAt: snapshot.generatedAt, supersededBuildAt, empty: snapshot.items.length === 0,
    }))
    window.sessionStorage.setItem(`${COLLECTION_CACHE_PREFIX}${route}`, serialized)
  } catch {
    memory.storageFailed = true
  }
  return { ...snapshot, source: 'session', preview: false, expiresAt: generatedAt + COLLECTION_SESSION_MAX_AGE_MS }
}
