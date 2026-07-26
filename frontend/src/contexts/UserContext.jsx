import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchMe,
  loginUser,
  registerUser,
  verifyLoginCode,
  confirmPasswordReset,
  requestLoginCode,
  requestPasswordReset,
  changePassword,
  revokeSessions,
  mergeTopicsCloud,
  mergeHistoryCloud,
} from '../api/user'
import { subscribeToUserUnauthorized, clearAuthScopedApiCache } from '../api/client'
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
  loginWithPassword: notReady,
  loginWithCode: notReady,
  requestLoginCode: notReady,
  requestPasswordReset: notReady,
  resetPassword: notReady,
  updatePassword: notReady,
  revokeAllSessions: notReady,
  register: notReady,
  logout: noop,
  refresh: async () => null,
  syncState: 'idle',
  retrySync: async () => false,
  setUser: noop,
}

const UserContext = createContext(defaultUserContextValue)

// On login/register, push any locally-tracked follows/history (anonymous
// localStorage state) up to the cloud so the account starts with the
// visitor's existing data. Best-effort: failures never block auth.
async function mergeLocalDataToCloud() {
  const topics = getFollowedTopics().map((t) => ({
    topic_key: t.topic_key,
    display_title: t.display_title,
  }))
  const items = getReadingHistory().map((h) => ({
    slug: h.slug,
    title: h.title,
    topic_key: h.topic_key,
    topic_display_title: h.topic_display_title,
    content_type: h.content_type,
    coverage_date: h.coverage_date,
    visited_at: h.visited_at,
  }))
  const pending = []
  if (topics.length) pending.push(mergeTopicsCloud(topics))
  if (items.length) pending.push(mergeHistoryCloud(items))
  const results = await Promise.allSettled(pending)
  if (results.some((result) => result.status === 'rejected')) {
    throw new Error('部分本地阅读数据暂未同步')
  }
  return true
}

export function UserProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [syncState, setSyncState] = useState('idle')

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
      // The API client owns 401 handling: it clears the token and emits
      // USER_UNAUTHORIZED_EVENT. Keep a valid token (and any current user)
      // for transient network/5xx failures so a temporary outage does not
      // turn into a forced logout.
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => subscribeToUserUnauthorized(() => {
    setUser(null)
    setLoading(false)
    setSyncState('idle')
  }), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const syncLocalData = useCallback(async () => {
    setSyncState('syncing')
    try {
      await mergeLocalDataToCloud()
      setSyncState('synced')
      return true
    } catch {
      setSyncState('error')
      return false
    }
  }, [])

  const login = useCallback(async (credentials) => {
    const data = await loginUser(credentials)
    setUserToken(data.access_token)
    setUser(data.user)
    void syncLocalData()
    return data.user
  }, [syncLocalData])

  const loginWithPassword = login

  const loginWithCode = useCallback(async (credentials) => {
    const data = await verifyLoginCode(credentials)
    setUserToken(data.access_token)
    setUser(data.user)
    void syncLocalData()
    return data.user
  }, [syncLocalData])

  const register = useCallback(async (payload) => {
    const data = await registerUser(payload)
    setUserToken(data.access_token)
    setUser(data.user)
    void syncLocalData()
    return data.user
  }, [syncLocalData])

  const finishAuthResponse = useCallback(async (data, { merge = false } = {}) => {
    setUserToken(data.access_token)
    setUser(data.user)
    if (merge) void syncLocalData()
    return data.user
  }, [syncLocalData])

  const resetPassword = useCallback(async (payload) => {
    return finishAuthResponse(await confirmPasswordReset(payload), { merge: true })
  }, [finishAuthResponse])

  const updatePassword = useCallback(async (payload) => {
    return finishAuthResponse(await changePassword(payload))
  }, [finishAuthResponse])

  const sendLoginCode = useCallback((payload) => requestLoginCode(payload), [])
  const sendPasswordReset = useCallback((payload) => requestPasswordReset(payload), [])

  // Dropping the token alone left this identity's already-fetched private responses
  // (account dashboard, following, reading history) sitting in the api client cache,
  // where the next viewer on a shared device could still read them from memory or
  // sessionStorage. Purge the user-scoped entries as part of signing out.
  const revokeAllSessions = useCallback(async () => {
    await revokeSessions()
    clearUserToken()
    clearAuthScopedApiCache('user')
    setUser(null)
    setSyncState('idle')
  }, [])

  const logout = useCallback(() => {
    clearUserToken()
    clearAuthScopedApiCache('user')
    setUser(null)
    setSyncState('idle')
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      loginWithPassword,
      loginWithCode,
      requestLoginCode: sendLoginCode,
      requestPasswordReset: sendPasswordReset,
      resetPassword,
      updatePassword,
      revokeAllSessions,
      register,
      logout,
      refresh,
      syncState,
      retrySync: syncLocalData,
      setUser,
    }),
    [user, loading, login, loginWithPassword, loginWithCode, sendLoginCode, sendPasswordReset, resetPassword, updatePassword, revokeAllSessions, register, logout, refresh, syncState, syncLocalData],
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
