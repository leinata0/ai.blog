import { useCallback, useEffect, useState } from 'react'
import { fetchPublicHome } from '../api/publicHome'
import { HOME_REFRESH_TIMEOUT_MS, readHomeBootstrap } from '../utils/homeBootstrap'

function seed(enabled) {
  const snapshot = readHomeBootstrap(Date.now(), { allowPreview: true })
  return { enabled, snapshot, loading: enabled && !snapshot, error: '', refreshError: '' }
}

export default function useHomeBootstrap(enabled) {
  const [state, setState] = useState(() => seed(enabled))
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) {
      setState((current) => ({ ...current, enabled: false, loading: false }))
      return undefined
    }
    let current = seed(true)
    setState(current)
    let disposed = false, request = null, freshnessTimer = null, deadlineTimer = null
    let lastStartedAt = -Infinity
    const visible = () => document.visibilityState !== 'hidden'
    const publish = (value) => { current = value; setState(value) }
    function clearTimers() {
      window.clearTimeout(freshnessTimer); window.clearTimeout(deadlineTimer)
      freshnessTimer = null; deadlineTimer = null
    }
    function fail(message) {
      if (current.snapshot && !current.snapshot.preview && current.snapshot.expiresAt > Date.now()) {
        publish({ ...current, loading: false, error: '', refreshError: message })
        schedule()
      } else publish({ enabled: true, snapshot: null, loading: false, error: message, refreshError: '' })
    }
    function schedule() {
      window.clearTimeout(freshnessTimer)
      freshnessTimer = null
      if (!current.snapshot) return
      freshnessTimer = window.setTimeout(() => {
        freshnessTimer = null
        if (!visible()) return
        if (current.snapshot?.preview) {
          request?.abort(); request = null
          window.clearTimeout(deadlineTimer); deadlineTimer = null
          fail('首页更新响应较慢，请重试。')
        } else refresh(true)
      }, Math.max(0, current.snapshot.expiresAt - Date.now()))
    }
    async function refresh(force = false, fromEvent = false) {
      if (disposed || request || (fromEvent && Date.now() - lastStartedAt < 1000)) return
      const active = new AbortController()
      request = active
      lastStartedAt = Date.now()
      clearTimers()
      const snapshot = current.snapshot && current.snapshot.expiresAt <= Date.now()
        ? { ...current.snapshot, preview: true, expiresAt: Date.now() + HOME_REFRESH_TIMEOUT_MS } : current.snapshot
      publish({ ...current, snapshot, loading: !snapshot, error: '', refreshError: '' })
      const budget = current.snapshot?.preview ? Math.max(0, Math.min(HOME_REFRESH_TIMEOUT_MS, current.snapshot.expiresAt - Date.now())) : HOME_REFRESH_TIMEOUT_MS
      deadlineTimer = window.setTimeout(() => {
        if (disposed || request !== active) return
        active.abort(); request = null; deadlineTimer = null
        fail('首页更新响应较慢，请重试。')
      }, budget)
      try {
        const snapshot = await fetchPublicHome({ forceRefresh: force || attempt > 0, signal: active.signal })
        if (disposed || active.signal.aborted) return
        publish({ enabled: true, snapshot, loading: false, error: '', refreshError: '' })
        schedule()
      } catch (error) {
        if (disposed || active.signal.aborted) return
        fail(error?.message || '首页暂时无法加载，请重试。')
      } finally {
        if (request === active) {
          request = null
          window.clearTimeout(deadlineTimer); deadlineTimer = null
        }
      }
    }
    function onReturn() {
      if (!visible()) return
      if (!request && current.snapshot?.preview && current.snapshot.expiresAt <= Date.now()) {
        publish({ ...current, snapshot: { ...current.snapshot, expiresAt: Date.now() + HOME_REFRESH_TIMEOUT_MS } })
      }
      refresh(true, true)
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onReturn)
    schedule()
    if (visible()) refresh()
    return () => {
      disposed = true; request?.abort(); clearTimers()
      window.removeEventListener('focus', onReturn)
      document.removeEventListener('visibilitychange', onReturn)
    }
  }, [enabled, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  const current = state.enabled === enabled ? state : enabled ? seed(true) : { ...state, loading: false }
  return {
    snapshot: current.snapshot, loading: current.loading, error: current.error, refreshError: current.refreshError,
    preview: Boolean(current.snapshot?.preview), generatedAt: current.snapshot?.undated ? '' : current.snapshot?.generatedAt || '',
    retry,
  }
}
