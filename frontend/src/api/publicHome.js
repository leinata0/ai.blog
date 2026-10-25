import { apiGet } from './client'
import { fetchHomeBootstrap } from './home'
import { fetchTopics } from './posts'
import { createPublicHomeSnapshot, serializePublicHomeSnapshot } from '../utils/publicHomeSnapshot'
import { HOME_REFRESH_TIMEOUT_MS, HOME_SESSION_MAX_AGE_MS, readHomeBootstrap, saveHomeBootstrap } from '../utils/homeBootstrap'
import { PERFORMANCE_TRIAL_ENABLED } from '../utils/performanceTrial'

export async function fetchPublicHome(options = {}) {
  const saved = readHomeBootstrap()
  if (!options.forceRefresh && saved?.source === 'session') return saved
  const sharedOptions = { ...options, auth: false, timeout: HOME_REFRESH_TIMEOUT_MS, cache: false, dedupe: true, forceRefresh: true, staleWhileRevalidate: false }
  let payload
  if (import.meta.env.PROD) {
    const credentials = typeof window !== 'undefined' && window.location.hostname.endsWith('.vercel.app') ? 'same-origin' : 'omit'
    payload = await apiGet('/public-data/home.json', { ...sharedOptions, credentials })
    if (payload?.schemaVersion !== 1 || payload.route !== '/') throw new Error('首页内容版本无效，请重试。')
  } else {
    const [home, topics] = await Promise.all([
      fetchHomeBootstrap({ page: 1, page_size: 10, include_modules: true }, sharedOptions),
      fetchTopics({ limit: 4 }, sharedOptions),
    ])
    payload = createPublicHomeSnapshot({ ...home, home_modules: { latest_weekly: [], featured_series: [], ...home.home_modules }, home_topics: topics.items })
  }
  const timestamp = Date.parse(payload?.generatedAt)
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60000 || Date.now() - timestamp >= HOME_SESSION_MAX_AGE_MS) throw new Error('首页内容暂时无法更新，请重试。')
  const snapshot = createPublicHomeSnapshot(payload, payload.generatedAt)
  if (!snapshot || !serializePublicHomeSnapshot(snapshot)) throw new Error('首页内容格式无效，请重试。')
  const accepted = saveHomeBootstrap(snapshot)
  if (!accepted) throw new Error('首页版本正在同步，请重试。')
  return accepted
}

export function prefetchPublicHome() {
  if (!PERFORMANCE_TRIAL_ENABLED) return
  return fetchPublicHome().catch(() => undefined)
}
