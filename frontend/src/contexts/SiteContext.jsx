import { createContext, useContext, useState, useEffect } from 'react'
import { apiGet } from '../api/client'

const SiteContext = createContext()
const SITE_PREWARM_KEY = 'blog.runtime_prewarm'

function scheduleBackgroundTask(task) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 800 })
    return () => window.cancelIdleCallback(id)
  }

  const id = window.setTimeout(task, 180)
  return () => window.clearTimeout(id)
}

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let cancelBackgroundTask = null

    if (typeof window !== 'undefined' && !window.sessionStorage.getItem(SITE_PREWARM_KEY)) {
      window.sessionStorage.setItem(SITE_PREWARM_KEY, new Date().toISOString())
      apiGet('/api/health', { cache: true, cacheTtl: 60000, staleTtl: 180000 }).catch(() => null)
    }

    apiGet('/api/settings', {
      cache: true,
      cacheTtl: 60000,
      staleTtl: 180000,
      staleWhileRevalidate: true,
    })
      .catch(() => null)
      .then((payload) => {
        if (!active) return
        setSettings(payload)
        setLoading(false)

        cancelBackgroundTask = scheduleBackgroundTask(() => {
          apiGet('/api/stats', {
            cache: true,
            cacheTtl: 45000,
            staleTtl: 180000,
            staleWhileRevalidate: true,
          })
            .then((statsPayload) => {
              if (!active) return
              setStats(statsPayload)
            })
            .catch(() => {})
        })
      })

    return () => {
      active = false
      cancelBackgroundTask?.()
    }
  }, [])

  const refreshSettings = () => apiGet('/api/settings', { forceRefresh: true }).then(setSettings).catch(() => {})
  const refreshStats = () => apiGet('/api/stats', { forceRefresh: true }).then(setStats).catch(() => {})

  return (
    <SiteContext.Provider value={{ settings, stats, loading, refreshSettings, refreshStats }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSite must be used within SiteProvider')
  return ctx
}
