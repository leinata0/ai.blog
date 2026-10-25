import { apiGet } from './client'
import { COLLECTION_ROUTES, COLLECTION_SCHEMA_VERSION, createCollectionSnapshot, serializeCollectionSnapshot } from '../utils/publicCollectionSnapshot'
import { COLLECTION_REFRESH_TIMEOUT_MS, COLLECTION_SESSION_MAX_AGE_MS, readCollectionBootstrap, saveCollectionSnapshot } from '../utils/collectionBootstrap'
import { PERFORMANCE_TRIAL_ENABLED } from '../utils/performanceTrial'

export function usesPublicCollectionEndpoint() {
  // Vite's development proxy does not execute the deployment's Node function.
  return PERFORMANCE_TRIAL_ENABLED && import.meta.env.PROD
}

export async function fetchPublicCollection(route, options = {}) {
  if (!COLLECTION_ROUTES.includes(route)) throw new Error('不支持的公开栏目')
  const now = Date.now()
  const saved = readCollectionBootstrap(route, now)
  if (!options.forceRefresh && saved?.source === 'session') return saved
  const name = route.slice(1)
  // Protected deployment previews need their existing Vercel session. The
  // public production domain omits cookies; the function never forwards either
  // kind of browser credential upstream and marks credentialed replies private.
  const credentials = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app') ? 'same-origin' : 'omit'
  // Shared inflight work is bounded and anonymous. One navigation cancelling
  // must not abort an intent-prefetch that another consumer is about to use.
  const payload = await apiGet(`/public-data/${name}.json`, {
    ...options, auth: false, credentials, timeout: COLLECTION_REFRESH_TIMEOUT_MS,
    cache: false, dedupe: true, forceRefresh: true, staleWhileRevalidate: false,
  })
  const generatedAt = Date.parse(payload?.generatedAt)
  if (payload?.schemaVersion !== COLLECTION_SCHEMA_VERSION || payload.route !== route || !Array.isArray(payload.items)
    || !Number.isFinite(generatedAt) || generatedAt > Date.now() + 60000 || Date.now() - generatedAt >= COLLECTION_SESSION_MAX_AGE_MS) {
    throw new Error('栏目内容暂时无法更新，请重试。')
  }
  const snapshot = createCollectionSnapshot(route, payload.items, payload.generatedAt)
  if (!serializeCollectionSnapshot(snapshot)) throw new Error('栏目内容暂时无法更新，请重试。')
  const accepted = saveCollectionSnapshot(route, snapshot.items, generatedAt)
  if (!accepted) throw new Error('栏目内容版本落后，请重试更新。')
  return accepted
}

export function prefetchPublicCollection(route) {
  if (!usesPublicCollectionEndpoint() || !COLLECTION_ROUTES.includes(route)) return
  return fetchPublicCollection(route).catch(() => undefined)
}
