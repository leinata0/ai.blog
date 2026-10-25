import { useEffect, useRef, useState } from 'react'
import { COLLECTION_REFRESH_TIMEOUT_MS, COLLECTION_SESSION_MAX_AGE_MS, readCollectionBootstrap, saveCollectionSnapshot } from '../utils/collectionBootstrap'
import { PERFORMANCE_TRIAL_ENABLED } from '../utils/performanceTrial'

function initialState(route) {
  const cached = readCollectionBootstrap(route, Date.now(), { allowPreview: true })
  return { route, items: cached?.items || [], loading: !cached, error: '', refreshError: '', preview: cached?.preview || false, generatedAt: cached?.generatedAt || '', expiresAt: cached?.expiresAt || 0 }
}

// The API client's SWR returns stale data without notifying React of its eventual
// update. Own the short-lived display snapshot here and explicitly await refresh.
export default function usePublicCollection({ route, load, errorMessage, legacyOptions = {} }) {
  const [state, setState] = useState(() => initialState(route))
  const [attempt, setAttempt] = useState(0)
  const loadRef = useRef(load)
  const legacyOptionsRef = useRef(legacyOptions)
  loadRef.current = load
  legacyOptionsRef.current = legacyOptions

  useEffect(() => {
    const controller = new AbortController()
    const seed = initialState(route)
    setState(seed)
    let current = seed
    let inFlight = false
    let activeRequest = null
    let freshnessTimer = null
    let lastRefreshStartedAt = -Infinity
    const options = PERFORMANCE_TRIAL_ENABLED
      ? { signal: controller.signal, timeout: COLLECTION_REFRESH_TIMEOUT_MS, cache: false, dedupe: false, forceRefresh: attempt > 0, staleWhileRevalidate: false }
      : { ...legacyOptionsRef.current, signal: controller.signal }
    const currentLoad = loadRef.current

    function publish(next) { current = next; setState(next) }
    function clearFreshnessTimer() {
      if (freshnessTimer !== null) window.clearTimeout(freshnessTimer)
      freshnessTimer = null
    }
    const isVisible = () => document.visibilityState !== 'hidden'
    function scheduleFreshness() {
      clearFreshnessTimer()
      if (!PERFORMANCE_TRIAL_ENABLED || !current.expiresAt) return
      freshnessTimer = window.setTimeout(() => {
        freshnessTimer = null
        // An expired hidden tab catches up once visible, without background polls.
        if (!isVisible()) return
        if (current.preview) {
          activeRequest?.abort()
          activeRequest = null
          inFlight = false
          publish({ route, items: [], loading: false, error: '更新响应较慢，请重试。', refreshError: '', preview: false, generatedAt: '', expiresAt: 0 })
        } else refresh()
      }, Math.max(0, current.expiresAt - Date.now()))
    }

    async function refresh(fromEvent = false) {
      if (controller.signal.aborted || inFlight) return
      // Browsers commonly emit visibilitychange and focus for the same return.
      if (fromEvent && Date.now() - lastRefreshStartedAt < 1000) return
      inFlight = true
      const request = new AbortController()
      activeRequest = request
      lastRefreshStartedAt = Date.now()
      clearFreshnessTimer()
      const hasDisplay = current.expiresAt > 0 || current.items.length > 0
      publish({ ...current, loading: !hasDisplay, error: '', refreshError: '' })
      if (current.preview) scheduleFreshness()
      try {
        const result = await currentLoad({ ...options, signal: request.signal, ...(PERFORMANCE_TRIAL_ENABLED ? { forceRefresh: options.forceRefresh || fromEvent } : {}) })
        if (controller.signal.aborted || request.signal.aborted) return
        const items = Array.isArray(result) ? result : Array.isArray(result?.items) ? result.items : []
        const receivedAt = Date.now()
        const timestamp = Array.isArray(result) ? receivedAt : Date.parse(result?.generatedAt)
        const generatedAt = Number.isFinite(timestamp) ? timestamp : receivedAt
        const saved = saveCollectionSnapshot(route, items, generatedAt)
        if (PERFORMANCE_TRIAL_ENABLED && !saved) throw new Error('栏目版本正在同步，请重试。')
        const confirmedItems = saved?.items || items
        const confirmedAt = saved ? Date.parse(saved.generatedAt) : generatedAt
        publish({ route, items: confirmedItems, loading: false, error: '', refreshError: '', preview: false, generatedAt: new Date(confirmedAt).toISOString(), expiresAt: PERFORMANCE_TRIAL_ENABLED ? confirmedAt + COLLECTION_SESSION_MAX_AGE_MS : 0 })
        scheduleFreshness()
      } catch (err) {
        // A request timeout is also named AbortError. Only our own abort means
        // navigation/unmount; an independent timeout must expire stale content.
        if (controller.signal.aborted || request.signal.aborted) return
        clearFreshnessTimer()
        const message = err?.message || errorMessage || '内容暂时无法加载，请稍后重试。'
        if (PERFORMANCE_TRIAL_ENABLED && !current.preview && Date.now() < current.expiresAt) {
          publish({ ...current, loading: false, refreshError: message })
          scheduleFreshness()
        } else {
          publish({ route, items: [], loading: false, error: message, refreshError: '', preview: false, generatedAt: '', expiresAt: 0 })
        }
      } finally {
        if (activeRequest === request) {
          activeRequest = null
          inFlight = false
        }
      }
    }

    function onReturn() {
      if (!isVisible()) return
      if (!inFlight && current.preview && current.expiresAt <= Date.now()) {
        publish({ ...current, expiresAt: Date.now() + COLLECTION_REFRESH_TIMEOUT_MS })
      }
      refresh(true)
    }
    if (PERFORMANCE_TRIAL_ENABLED) {
      window.addEventListener('focus', onReturn)
      document.addEventListener('visibilitychange', onReturn)
      scheduleFreshness()
    }
    if (!PERFORMANCE_TRIAL_ENABLED || isVisible()) refresh()
    return () => {
      controller.abort()
      activeRequest?.abort()
      clearFreshnessTimer()
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [route, attempt, errorMessage])

  const current = state.route === route ? state : initialState(route)
  return { ...current, retry: () => setAttempt((value) => value + 1) }
}
