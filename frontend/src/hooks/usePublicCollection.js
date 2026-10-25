import { useEffect, useRef, useState } from 'react'
import { COLLECTION_SESSION_MAX_AGE_MS, readCollectionBootstrap, saveCollectionSnapshot } from '../utils/collectionBootstrap'
import { PERFORMANCE_TRIAL_ENABLED } from '../utils/performanceTrial'

function initialState(route) {
  const cached = readCollectionBootstrap(route)
  return { route, items: cached?.items || [], loading: !cached, error: '', refreshError: '', expiresAt: cached?.expiresAt || 0 }
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
    const cached = readCollectionBootstrap(route)
    const seed = { route, items: cached?.items || [], loading: !cached, error: '', refreshError: '', expiresAt: cached?.expiresAt || 0 }
    setState(seed)
    let current = seed
    let inFlight = false
    let freshnessTimer = null
    let lastRefreshStartedAt = -Infinity
    const options = PERFORMANCE_TRIAL_ENABLED
      ? { signal: controller.signal, cache: false, dedupe: false, forceRefresh: true, staleWhileRevalidate: false }
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
        if (isVisible()) refresh()
      }, Math.max(0, current.expiresAt - Date.now()))
    }

    async function refresh(fromEvent = false) {
      if (controller.signal.aborted || inFlight) return
      // Browsers commonly emit visibilitychange and focus for the same return.
      if (fromEvent && Date.now() - lastRefreshStartedAt < 1000) return
      inFlight = true
      lastRefreshStartedAt = Date.now()
      clearFreshnessTimer()
      const hasDisplay = current.expiresAt > 0 || current.items.length > 0
      publish({ ...current, loading: !hasDisplay, error: '', refreshError: '' })
      try {
        const result = await currentLoad(options)
        if (controller.signal.aborted) return
        const items = Array.isArray(result) ? result : []
        const now = Date.now()
        saveCollectionSnapshot(route, items, now)
        publish({ route, items, loading: false, error: '', refreshError: '', expiresAt: PERFORMANCE_TRIAL_ENABLED ? now + COLLECTION_SESSION_MAX_AGE_MS : 0 })
        scheduleFreshness()
      } catch (err) {
        // A request timeout is also named AbortError. Only our own abort means
        // navigation/unmount; an independent timeout must expire stale content.
        if (controller.signal.aborted) return
        const message = err?.message || errorMessage || '内容暂时无法加载，请稍后重试。'
        if (PERFORMANCE_TRIAL_ENABLED && Date.now() < current.expiresAt) {
          publish({ ...current, loading: false, refreshError: message })
          scheduleFreshness()
        } else {
          publish({ route, items: [], loading: false, error: message, refreshError: '', expiresAt: 0 })
        }
      } finally {
        inFlight = false
      }
    }

    function onReturn() { if (isVisible()) refresh(true) }
    if (PERFORMANCE_TRIAL_ENABLED) {
      window.addEventListener('focus', onReturn)
      document.addEventListener('visibilitychange', onReturn)
      scheduleFreshness()
    }
    if (!PERFORMANCE_TRIAL_ENABLED || isVisible()) refresh()
    return () => {
      controller.abort()
      clearFreshnessTimer()
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [route, attempt, errorMessage])

  const current = state.route === route ? state : initialState(route)
  return { ...current, retry: () => setAttempt((value) => value + 1) }
}
