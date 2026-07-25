import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const ThemeContext = createContext()

function readInitialDarkMode() {
  if (typeof window === 'undefined') return false
  try {
    const saved = window.localStorage.getItem('theme')
    if (saved) return saved === 'dark'
  } catch {
    // Storage can be blocked by browser privacy or embedding policies.
  }
  try {
    return Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  } catch {
    return false
  }
}

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(readInitialDarkMode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    const themeMeta = document.querySelector('meta[name="theme-color"]')
    const standard = document.documentElement.dataset.surface === 'standard'
    if (themeMeta) themeMeta.setAttribute('content', standard ? (dark ? '#09111d' : '#edf3f8') : (dark ? '#071016' : '#f3f3ef'))
    try {
      window.localStorage.setItem('theme', dark ? 'dark' : 'light')
    } catch {
      // The theme still works in memory when persistence is unavailable.
    }
  }, [dark])

  const toggleTheme = useCallback(() => {
    setDark((current) => !current)
  }, [])

  const value = useMemo(
    () => ({ dark, setDark, toggleTheme }),
    [dark, toggleTheme],
  )

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
