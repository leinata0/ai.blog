import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { apiGet } from '../api/client'
import { fetchHomeBootstrap } from '../api/home'
import { normalizePostList } from '../api/posts'

const defaultSiteContextValue = {
  settings: null,
  stats: null,
  bootstrap: null,
  bootstrapLoading: false,
  loading: false,
  refreshSettings: async () => {},
  refreshStats: async () => {},
}

const SiteContext = createContext(defaultSiteContextValue)

// window.__BLOG_BOOTSTRAP__ 是构建期快照。它只该在冷启动时当首屏占位用一次；
// 一个 SPA 开一整天，每次回到 "/" 都拿构建期数据覆盖当前 state 会反复闪陈旧列表。
const RUNTIME_BOOTSTRAP_MAX_AGE_MS = 30 * 60 * 1000
const consumedRuntimeBootstraps = new WeakSet()

/** Keep the shape contract identical to api/home.js normalizeSettings. */
function normalizeBootstrapSettings(payload) {
  if (!payload || typeof payload !== 'object') return null
  return {
    author_name: payload.author_name ?? '',
    bio: payload.bio ?? '',
    avatar_url: payload.avatar_url ?? '',
    hero_image: payload.hero_image ?? '',
    github_link: payload.github_link ?? '',
    announcement: payload.announcement ?? '',
    site_url: payload.site_url ?? '',
    friend_links: payload.friend_links ?? '[]',
  }
}

function readRuntimeBootstrap() {
  if (typeof window === 'undefined') return null
  const payload = window.__BLOG_BOOTSTRAP__
  if (!payload || typeof payload !== 'object') return null

  const settings = normalizeBootstrapSettings(payload.settings)
  if (!settings && !payload.posts) return null

  // HomePage consumes bootstrap.posts.items directly, so it must go through the same
  // normalizer as the API path instead of relying on the raw backend JSON shape.
  return {
    ...payload,
    settings,
    posts: payload.posts ? normalizePostList(payload.posts) : null,
  }
}

/** Fresh enough to seed first paint, and only ever consumed once per page load. */
function readUnconsumedRuntimeBootstrap() {
  if (typeof window === 'undefined') return null
  const raw = window.__BLOG_BOOTSTRAP__
  if (!raw || typeof raw !== 'object') return null
  if (consumedRuntimeBootstraps.has(raw)) return null

  const generatedAt = Date.parse(raw.generatedAt ?? raw.generated_at ?? '')
  if (Number.isFinite(generatedAt) && Date.now() - generatedAt > RUNTIME_BOOTSTRAP_MAX_AGE_MS) return null

  return readRuntimeBootstrap()
}

function markRuntimeBootstrapConsumed() {
  if (typeof window === 'undefined') return
  const raw = window.__BLOG_BOOTSTRAP__
  if (raw && typeof raw === 'object') consumedRuntimeBootstraps.add(raw)
}

function scheduleBackgroundTask(task) {
  if (typeof window === 'undefined') {
    const id = setTimeout(task, 180)
    return () => clearTimeout(id)
  }
  if (typeof window.requestIdleCallback === 'function') {
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
  const [homeBootstrapSettled, setHomeBootstrapSettled] = useState(() => Boolean(readRuntimeBootstrap()?.posts))

  // 这个 effect 只按路由重跑，但闭包里要读 settings —— 用 ref 取当前值，避免陈旧闭包。
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

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
      if (!settingsRef.current) {
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
          // A network blip must not blank out author info / site_url that we already have.
          if (!payload && settingsRef.current) {
            setLoading(false)
            return
          }
          applySettings(payload, null)
        })
    }

    function refreshHomeBootstrap(preserveCurrent = true) {
      // Prefer memory/session cache and SWR. Only force a network round-trip when
      // there is no current bootstrap/settings to show (cold client load).
      fetchHomeBootstrap(
        { page: 1, page_size: 10, include_modules: false },
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
          setHomeBootstrapSettled(true)
          applySettings(payload.settings, payload)
        })
        .catch(() => {
          if (!active || preserveCurrent) return
          setHomeBootstrapSettled(true)
          loadSettingsFallback({ forceRefresh: true })
        })
    }

    if (isHomeRoute) {
      const runtimeBootstrap = readUnconsumedRuntimeBootstrap()
      if (runtimeBootstrap?.settings) {
        markRuntimeBootstrapConsumed()
        setHomeBootstrapSettled(true)
        applySettings(runtimeBootstrap.settings, runtimeBootstrap)
        // Background revalidation only — do not bypass the client cache.
        refreshHomeBootstrap(true)
      } else {
        setHomeBootstrapSettled(false)
        if (!settingsRef.current) {
          setLoading(true)
        }

        refreshHomeBootstrap(false)
      }
    } else if (!settingsRef.current) {
      loadSettingsFallback()
    } else {
      setLoading(false)
      setBootstrap(null)
      setHomeBootstrapSettled(false)
      loadStatsInBackground()
    }

    return () => {
      active = false
      cancelBackgroundTask?.()
    }
  }, [location.pathname])

  const refreshSettings = useCallback(
    () => apiGet('/api/settings', { forceRefresh: true })
      .then((payload) => {
        // Never downgrade to null: an empty/failed response leaves the current site
        // identity (author, site_url, friend links) in place instead of clearing it.
        if (payload) setSettings(payload)
      })
      .catch(() => {}),
    [],
  )
  const refreshStats = useCallback(
    () => apiGet('/api/stats', { forceRefresh: true }).then(setStats).catch(() => {}),
    [],
  )

  const bootstrapLoading = location.pathname === '/' && !bootstrap?.posts && !homeBootstrapSettled
  const value = useMemo(
    () => ({ settings, stats, bootstrap, bootstrapLoading, loading, refreshSettings, refreshStats }),
    [settings, stats, bootstrap, bootstrapLoading, loading, refreshSettings, refreshStats],
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
