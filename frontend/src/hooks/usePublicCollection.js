import { useEffect, useRef, useState } from 'react'
import { readCollectionBootstrap, saveCollectionSnapshot } from '../utils/collectionBootstrap'
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
    const options = PERFORMANCE_TRIAL_ENABLED
      ? { signal: controller.signal, cache: false, dedupe: false, forceRefresh: true, staleWhileRevalidate: false }
      : { ...legacyOptionsRef.current, signal: controller.signal }
    const currentLoad = loadRef.current
    let completed = false
    const expiry = cached ? window.setTimeout(() => {
      // A failed refresh cannot keep a withdrawn article visible indefinitely.
      if (!controller.signal.aborted) setState((current) => current.expiresAt === cached.expiresAt ? { ...current, items: [], loading: !completed, error: completed ? errorMessage : '', refreshError: '', expiresAt: 0 } : current)
    }, Math.max(0, cached.expiresAt - Date.now())) : null

    async function refresh() {
      try {
        const result = await currentLoad(options)
        if (controller.signal.aborted) return
        completed = true
        if (expiry !== null) window.clearTimeout(expiry)
        const items = Array.isArray(result) ? result : []
        saveCollectionSnapshot(route, items)
        setState({ route, items, loading: false, error: '', refreshError: '', expiresAt: 0 })
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        completed = true
        const message = err?.message || errorMessage || '内容暂时无法加载，请稍后重试。'
        if (cached && Date.now() < cached.expiresAt) setState({ ...seed, loading: false, refreshError: message })
        else setState({ route, items: [], loading: false, error: message, refreshError: '', expiresAt: 0 })
      }
    }
    refresh()
    return () => { controller.abort(); if (expiry !== null) window.clearTimeout(expiry) }
  }, [route, attempt, errorMessage])

  const current = state.route === route ? state : initialState(route)
  return { ...current, retry: () => setAttempt((value) => value + 1) }
}
