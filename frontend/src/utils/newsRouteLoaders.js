import { PERFORMANCE_TRIAL_ENABLED } from './performanceTrial'

// Share these exact import functions with React.lazy so navigation can reuse
// a chunk requested on deliberate pointer/keyboard intent.
export const loadContentTypePage = () => import('../pages/ContentTypePage')
export const loadTopicsPage = () => import('../pages/TopicsPage')
export const loadSeriesPage = () => import('../pages/SeriesPage')
export const loadStartHerePage = () => import('../pages/StartHerePage')

const loaders = {
  '/daily': loadContentTypePage,
  '/weekly': loadContentTypePage,
  '/topics': loadTopicsPage,
  '/series': loadSeriesPage,
  '/start-here': loadStartHerePage,
}
const requested = new Map()

export function preloadNewsRoute(path) {
  if (!PERFORMANCE_TRIAL_ENABLED) return
  const connection = typeof navigator !== 'undefined' ? navigator.connection : null
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return
  const loader = loaders[path]
  if (!loader || requested.has(loader)) return
  const promise = loader().catch(() => {
    // A speculative failure must not poison a later navigation or reload the page.
    if (requested.get(loader) === promise) requested.delete(loader)
  })
  requested.set(loader, promise)
}
