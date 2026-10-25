import { PERFORMANCE_TRIAL_ENABLED } from './performanceTrial'
import { createPublicHomeSnapshot, serializePublicHomeSnapshot } from './publicHomeSnapshot'

export const HOME_CACHE_KEY = 'blog.home-trial:/'
export const HOME_WATERMARK_KEY = 'blog.home-trial:watermark:/'
export const HOME_SESSION_MAX_AGE_MS = 5 * 60 * 1000
export const HOME_BUILD_MAX_AGE_MS = 30 * 60 * 1000
export const HOME_REFRESH_TIMEOUT_MS = 8000
const MAX_BYTES = 128 * 1024
const supersededBuilds = new WeakSet()
let verified = null // One homepage, with no query-dependent or unbounded keys.

function normalize(payload, now, legacy = false) {
  if (!payload || typeof payload !== 'object') return null
  if (!legacy && (payload.schemaVersion !== 1 || payload.route !== '/')) return null
  const rawTime = payload.generatedAt ?? payload.generated_at
  const timestamp = Date.parse(rawTime)
  if ((!Number.isFinite(timestamp) && !legacy) || timestamp > now + 60000) return null
  const source = legacy ? {
    ...payload,
    settings: payload.settings || {},
    posts: payload.posts,
    home_modules: { latest_weekly: [], featured_series: [], ...payload.home_modules },
    home_topics: payload.home_topics || [],
  } : payload
  const snapshot = createPublicHomeSnapshot(source, Number.isFinite(timestamp) ? rawTime : new Date(0).toISOString())
  return snapshot && serializePublicHomeSnapshot(snapshot) ? { ...snapshot, undated: !Number.isFinite(timestamp) } : null
}

function builds() {
  return [...new Set([window.__BLOG_HOME_BOOTSTRAP__, window.__BLOG_BOOTSTRAP__].filter(Boolean))]
}

const isEmpty = (snapshot) => snapshot.posts.items.length === 0 && snapshot.home_modules.latest_weekly.length === 0

function readVerification(now) {
  let memory = verified
  if (memory && Date.parse(memory.snapshot.generatedAt) > now + 60000) memory = null
  let stored = null, mark = null, unavailable = false
  try {
    const raw = window.sessionStorage.getItem(HOME_CACHE_KEY)
    const rawMark = window.sessionStorage.getItem(HOME_WATERMARK_KEY)
    if (!raw && !rawMark && !memory?.storageFailed) { verified = null; memory = null }
    if (raw && raw.length <= MAX_BYTES) {
      try { stored = normalize(JSON.parse(raw), now) } catch { /* Invalid/interrupted cache. */ }
    }
    if (rawMark && rawMark.length < 2048) {
      try {
        const value = JSON.parse(rawMark)
        const generatedAt = Date.parse(value.generatedAt)
        if (value.schemaVersion === 1 && value.route === '/' && Number.isFinite(generatedAt) && generatedAt <= now + 60000) {
          mark = { generatedAt, empty: value.empty === true, supersededBuildAt: Number.isFinite(value.supersededBuildAt) && value.supersededBuildAt <= now + 60000 ? value.supersededBuildAt : -Infinity }
        }
      } catch { /* Metadata never grants a new freshness lease. */ }
    }
  } catch { unavailable = true }
  if (stored && mark?.empty && Date.parse(stored.generatedAt) === mark.generatedAt && !isEmpty(stored)) stored = null
  const generatedAt = Math.max(mark?.generatedAt ?? -Infinity, stored ? Date.parse(stored.generatedAt) : -Infinity, memory ? Date.parse(memory.snapshot.generatedAt) : -Infinity)
  const known = [stored, memory?.snapshot].filter((item) => item && Date.parse(item.generatedAt) === generatedAt)
    .sort((a, b) => Number(isEmpty(b)) - Number(isEmpty(a)))[0] || null
  return {
    generatedAt, known,
    snapshot: stored && Date.parse(stored.generatedAt) === generatedAt ? stored : unavailable || memory?.storageFailed ? known : null,
    empty: Boolean(known && isEmpty(known)) || (mark?.generatedAt === generatedAt && mark.empty),
    supersededBuildAt: Math.max(mark?.supersededBuildAt ?? -Infinity, memory?.supersededBuildAt ?? -Infinity),
  }
}

function display(snapshot, source, now, allowPreview) {
  if (!snapshot) return null
  const generatedAt = Date.parse(snapshot.generatedAt)
  const maxAge = source === 'build' ? HOME_BUILD_MAX_AGE_MS : HOME_SESSION_MAX_AGE_MS
  const preview = snapshot.undated || now - generatedAt >= maxAge
  if (preview && (!allowPreview || isEmpty(snapshot))) return null
  return { ...snapshot, source, preview, expiresAt: preview ? now + HOME_REFRESH_TIMEOUT_MS : generatedAt + maxAge }
}

export function readHomeBootstrap(now = Date.now(), { allowPreview = false } = {}) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined') return null
  const verification = readVerification(now)
  const candidates = [display(verification.snapshot, 'session', now, allowPreview)].filter(Boolean)
  for (const raw of builds()) {
    if (supersededBuilds.has(raw)) continue
    const snapshot = normalize(raw, now, raw.schemaVersion === undefined)
    const timestamp = Date.parse(snapshot?.generatedAt)
    if (!snapshot || timestamp <= verification.generatedAt || timestamp <= verification.supersededBuildAt) continue
    const candidate = display(snapshot, 'build', now, allowPreview)
    if (candidate) candidates.push(candidate)
  }
  return candidates.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))[0] || null
}

export function saveHomeBootstrap(payload, generatedAt = Date.parse(payload?.generatedAt)) {
  if (!PERFORMANCE_TRIAL_ENABLED || typeof window === 'undefined' || !Number.isFinite(generatedAt)) return null
  const now = Date.now()
  const snapshot = normalize({ ...payload, generatedAt: new Date(generatedAt).toISOString() }, now)
  if (!snapshot) return null
  const verification = readVerification(now)
  if (generatedAt < verification.generatedAt || (generatedAt === verification.generatedAt && verification.empty && !isEmpty(snapshot))) {
    return display(verification.known, 'session', now, false)
  }
  let supersededBuildAt = verification.supersededBuildAt
  for (const raw of builds()) {
    const built = normalize(raw, now, raw.schemaVersion === undefined)
    if (!built) continue
    supersededBuilds.add(raw)
    supersededBuildAt = Math.max(supersededBuildAt, Date.parse(built.generatedAt))
  }
  verified = { snapshot, supersededBuildAt, storageFailed: false }
  try {
    window.sessionStorage.setItem(HOME_WATERMARK_KEY, JSON.stringify({ schemaVersion: 1, route: '/', generatedAt: snapshot.generatedAt, supersededBuildAt: Number.isFinite(supersededBuildAt) ? supersededBuildAt : 0, empty: isEmpty(snapshot) }))
    window.sessionStorage.setItem(HOME_CACHE_KEY, serializePublicHomeSnapshot(snapshot))
  } catch { verified.storageFailed = true }
  return display(snapshot, 'session', now, false)
}
