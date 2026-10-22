export const SURFACES = Object.freeze({
  EDITORIAL: 'editorial',
  AUTH: 'auth',
  OPERATIONS: 'operations',
})

const AUTH_ROUTES = new Set([
  '/account',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
])

const THEME_COLORS = Object.freeze({
  [SURFACES.EDITORIAL]: { light: '#f8f6f1', dark: '#1c1b18' },
  [SURFACES.AUTH]: { light: '#eeefe9', dark: '#080f13' },
  [SURFACES.OPERATIONS]: { light: '#e9edef', dark: '#05090d' },
})

function normalizePathname(pathname = '/') {
  const normalized = String(pathname || '/').split(/[?#]/, 1)[0].replace(/\/+$/, '')
  return normalized || '/'
}

export function getSurfaceForPath(pathname) {
  const normalized = normalizePathname(pathname)
  if (normalized === '/admin' || normalized.startsWith('/admin/')) return SURFACES.OPERATIONS
  if (AUTH_ROUTES.has(normalized)) return SURFACES.AUTH
  return SURFACES.EDITORIAL
}

export function getThemeColor(surface, dark, newsStyle = 'paper') {
  if (surface === SURFACES.EDITORIAL && newsStyle === 'tech') return '#eee9df'
  const palette = THEME_COLORS[surface] || THEME_COLORS[SURFACES.EDITORIAL]
  return dark ? palette.dark : palette.light
}

export function applyDocumentSurface(pathname, documentRef = globalThis.document) {
  if (!documentRef?.documentElement) return SURFACES.EDITORIAL

  const surface = getSurfaceForPath(pathname)
  const root = documentRef.documentElement
  root.dataset.surface = surface

  const dark = root.dataset.theme === 'dark'
  const themeMeta = documentRef.querySelector('meta[name="theme-color"]')
  if (themeMeta) themeMeta.setAttribute('content', getThemeColor(surface, dark, root.dataset.newsStyle))

  const isPrivateSurface = surface !== SURFACES.EDITORIAL
  let robotsMeta = documentRef.querySelector('meta[name="robots"][data-surface-managed]')
  if (isPrivateSurface) {
    if (!robotsMeta) {
      robotsMeta = documentRef.createElement('meta')
      robotsMeta.setAttribute('name', 'robots')
      robotsMeta.setAttribute('data-surface-managed', '')
      documentRef.head.appendChild(robotsMeta)
    }
    robotsMeta.setAttribute('content', 'noindex,nofollow')
  } else {
    robotsMeta?.remove()
  }

  return surface
}

export function applyDocumentTheme(dark, documentRef = globalThis.document) {
  if (!documentRef?.documentElement) return
  const root = documentRef.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  const surface = root.dataset.surface || SURFACES.EDITORIAL
  const themeMeta = documentRef.querySelector('meta[name="theme-color"]')
  if (themeMeta) themeMeta.setAttribute('content', getThemeColor(surface, dark, root.dataset.newsStyle))
}

export function applyDocumentNewsStyle(style, documentRef = globalThis.document) {
  if (!documentRef?.documentElement) return
  documentRef.documentElement.dataset.newsStyle = style === 'paper' ? 'paper' : 'tech'
  applyDocumentTheme(documentRef.documentElement.dataset.theme === 'dark', documentRef)
}
