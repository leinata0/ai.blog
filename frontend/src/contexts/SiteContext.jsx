import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { apiGet } from '../api/client'
import { fetchHomeBootstrap } from '../api/home'

const defaultSiteContextValue = {
  settings: null,
  stats: null,
  bootstrap: null,
  loading: false,
  refreshSettings: async () => {},
  refreshStats: async () => {},
}

const SiteContext = createContext(defaultSiteContextValue)

function readRuntimeBootstrap() {
  if (typeof window === 'undefined') return null
  const payload = window.__BLOG_BOOTSTRAP__
  if (!payload || typeof payload !== 'object') return null
  return payload
}

function scheduleBackgroundTask(task) {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 800 })
    return () => window.cancelIdleCallback(id)
  }

  const id = window.setTimeout(task, 180)
  return () => window.clearTimeout(id)
}

export function SiteProvider({ children }) {
  const location = useLocation()
  const [bootstrap, setBootstrap] = useState(() => readRuntimeBootstrap())
  const [settings, setSettings] = useState(() => readRuntimeBootstrap()?.settings ?? null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(() => readRuntimeBootstrap()?.settings == null)

  useEffect(() => {
    let active = true
    let cancelBackgroundTask = null
    const isHomeRoute = location.pathname === '/'

    function loadStatsInBackground() {
      cancelBackgroundTask?.()
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
    }

    function applySettings(nextSettings, nextBootstrap = null) {
      if (!active) return
      setSettings(nextSettings || null)
      setBootstrap(nextBootstrap)
      setLoading(false)
      loadStatsInBackground()
    }

    function loadSettingsFallback(requestOptions = {}) {
      if (!settings) {
        setLoading(true)
      }

      apiGet('/api/settings', {
        cache: true,
        cacheTtl: 60000,
        staleTtl: 180000,
        staleWhileRevalidate: true,
        ...requestOptions,
      })
        .catch(() => null)
        .then((payload) => {
          if (!active) return
          applySettings(payload, null)
        })
    }

    function refreshHomeBootstrap(preserveCurrent = true) {
      // Prefer memory/session cache and SWR. Only force a network round-trip when
      // there is no current bootstrap/settings to show (cold client load).
      fetchHomeBootstrap(
        { page: 1, page_size: 10 },
        {
          cache: true,
          cacheTtl: 60000,
          staleTtl: 180000,
          staleWhileRevalidate: true,
          forceRefresh: !preserveCurrent,
        },
      )
        .then((payload) => {
          if (!active || !payload?.settings) return
          applySettings(payload.settings, payload)
        })
        .catch(() => {
          if (!active || preserveCurrent) return
          loadSettingsFallback({ forceRefresh: true })
        })
    }

    if (isHomeRoute) {
      const runtimeBootstrap = readRuntimeBootstrap()
      if (runtimeBootstrap?.settings) {
        applySettings(runtimeBootstrap.settings, runtimeBootstrap)
        // Background revalidation only — do not bypass the client cache.
        refreshHomeBootstrap(true)
      } else {
        if (!settings) {
          setLoading(true)
        }

        refreshHomeBootstrap(false)
      }
    } else if (!settings) {
      loadSettingsFallback()
    } else {
      setLoading(false)
      setBootstrap(null)
      loadStatsInBackground()
    }

    return () => {
      active = false
      cancelBackgroundTask?.()
    }
  }, [location.pathname])

  const refreshSettings = useCallback(
    () => apiGet('/api/settings', { forceRefresh: true }).then(setSettings).catch(() => {}),
    [],
  )
  const refreshStats = useCallback(
    () => apiGet('/api/stats', { forceRefresh: true }).then(setStats).catch(() => {}),
    [],
  )

  const value = useMemo(
    () => ({ settings, stats, bootstrap, loading, refreshSettings, refreshStats }),
    [settings, stats, bootstrap, loading, refreshSettings, refreshStats],
  )

  return (
    <SiteContext.Provider value={value}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  return useContext(SiteContext) || defaultSiteContextValue
}
