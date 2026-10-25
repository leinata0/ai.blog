import { afterEach, expect, it, vi } from 'vitest'

const loads = vi.hoisted(() => ({ content:vi.fn(), topics:vi.fn(), series:vi.fn(), guide:vi.fn() }))
vi.mock('../src/pages/ContentTypePage', () => { loads.content(); return { default:() => null } })
vi.mock('../src/pages/TopicsPage', () => { loads.topics(); return { default:() => null } })
vi.mock('../src/pages/SeriesPage', () => { loads.series(); return { default:() => null } })
vi.mock('../src/pages/StartHerePage', () => { loads.guide(); return { default:() => null } })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks() })

it('shares the daily and weekly chunk and avoids loading private routes', async () => {
  const { preloadNewsRoute, loadContentTypePage } = await import('../src/utils/newsRouteLoaders')
  preloadNewsRoute('/daily')
  preloadNewsRoute('/weekly')
  preloadNewsRoute('/account')
  preloadNewsRoute('/admin/dashboard')
  await loadContentTypePage()
  expect(loads.content).toHaveBeenCalledTimes(1)
  expect(loads.topics).not.toHaveBeenCalled()
  expect(loads.series).not.toHaveBeenCalled()
})

it('does no speculative work when the trial is disabled', async () => {
  vi.stubEnv('VITE_PERFORMANCE_TRIAL', '0')
  const { preloadNewsRoute } = await import('../src/utils/newsRouteLoaders')
  preloadNewsRoute('/start-here')
  await Promise.resolve()
  expect(loads.guide).not.toHaveBeenCalled()
})

it('respects reduced data and slow connections', async () => {
  vi.stubGlobal('navigator', { connection:{ saveData:true, effectiveType:'4g' } })
  const { preloadNewsRoute } = await import('../src/utils/newsRouteLoaders')
  preloadNewsRoute('/topics')
  navigator.connection = { saveData:false, effectiveType:'slow-2g' }
  preloadNewsRoute('/series')
  await Promise.resolve()
  expect(loads.topics).not.toHaveBeenCalled()
  expect(loads.series).not.toHaveBeenCalled()
})
