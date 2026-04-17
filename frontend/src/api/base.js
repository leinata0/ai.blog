function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function isLocalBrowserHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

export function resolveApiBase(currentLocation = globalThis?.window?.location) {
  const configuredBase = normalizeBaseUrl(import.meta.env.VITE_API_BASE)
  if (!configuredBase) return ''

  if (envEnabled(import.meta.env.VITE_ALLOW_CROSS_ORIGIN_API)) {
    return configuredBase
  }

  if (!currentLocation?.origin || !currentLocation?.hostname) {
    return configuredBase
  }

  try {
    const targetOrigin = new URL(configuredBase, currentLocation.origin).origin
    if (targetOrigin === currentLocation.origin) {
      return configuredBase
    }
  } catch {
    return configuredBase
  }

  return isLocalBrowserHost(currentLocation.hostname) ? configuredBase : ''
}

export function buildApiUrl(path = '', currentLocation = globalThis?.window?.location) {
  const base = resolveApiBase(currentLocation)
  const normalizedPath = String(path || '')

  if (!base) return normalizedPath
  if (!normalizedPath) return base

  return `${base}${normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`}`
}
