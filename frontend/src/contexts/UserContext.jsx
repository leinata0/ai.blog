import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchMe,
  loginUser,
  registerUser,
  mergeTopicsCloud,
  mergeHistoryCloud,
} from '../api/user'
import { getUserToken, setUserToken, clearUserToken, isUserTokenExpired } from '../api/userAuth'
import { getFollowedTopics, getReadingHistory } from '../utils/topicRetention'

const noop = () => {}
const notReady = async () => {
  throw new Error('UserProvider is not mounted')
}

// A default value (mirroring SiteContext) so components that call useUser()
// outside a provider — e.g. in isolated unit tests or the prerender path —
// degrade to a logged-out viewer instead of throwing.
const defaultUserContextValue = {
  user: null,
  loading: false,
  login: notReady,
  register: notReady,
  logout: noop,
  refresh: async () => null,
  setUser: noop,
}

const UserContext = createContext(defaultUserContextValue)

// On login/register, push any locally-tracked follows/history (anonymous
// localStorage state) up to the cloud so the account starts with the
// visitor's existing data. Best-effort: failures never block auth.
async function mergeLocalDataToCloud() {
  try {
    const topics = getFollowedTopics().map((t) => ({
      topic_key: t.topic_key,
      display_title: t.display_title,
    }))
    if (topics.length) await mergeTopicsCloud(topics)

    const items = getReadingHistory().map((h) => ({
      slug: h.slug,
      title: h.title,
      topic_key: h.topic_key,
      topic_display_title: h.topic_display_title,
      content_type: h.content_type,
      coverage_date: h.coverage_date,
      visited_at: h.visited_at,
    }))
    if (items.length) await mergeHistoryCloud(items)
  } catch {
    // Non-fatal: the user is still logged in; sync can happen later.
  }
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getUserToken() || isUserTokenExpired()) {
      clearUserToken()
      setUser(null)
      setLoading(false)
      return null
    }
    try {
      const me = await fetchMe()
      setUser(me)
      return me
    } catch {
      clearUserToken()
      setUser(null)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = useCallback(async (credentials) => {
    const data = await loginUser(credentials)
    setUserToken(data.access_token)
    setUser(data.user)
    await mergeLocalDataToCloud()
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await registerUser(payload)
    setUserToken(data.access_token)
    setUser(data.user)
    await mergeLocalDataToCloud()
    return data.user
  }, [])

  const logout = useCallback(() => {
    clearUserToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, setUser }),
    [user, loading, login, register, logout, refresh],
  )

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser() {
  return useContext(UserContext)
}
