const TOKEN_KEY = 'user_token'

export function getUserToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setUserToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearUserToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isUserTokenExpired() {
  const token = getUserToken()
  if (!token) return true
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}
