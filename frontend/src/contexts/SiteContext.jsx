import { createContext, useContext, useState, useEffect } from 'react'
import { apiGet } from '../api/client'

const SiteContext = createContext()

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      apiGet('/api/settings').catch(() => null),
      apiGet('/api/stats').catch(() => null),
    ]).then(([s, st]) => {
      setSettings(s)
      setStats(st)
      setLoading(false)
    })
  }, [])

  const refreshSettings = () => apiGet('/api/settings').then(setSettings).catch(() => {})
  const refreshStats = () => apiGet('/api/stats').then(setStats).catch(() => {})

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
