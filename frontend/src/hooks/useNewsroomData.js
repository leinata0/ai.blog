import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchHomeModules } from '../api/home'
import { fetchTopics } from '../api/posts'

function hasEditorialModules(modules) {
  return (Array.isArray(modules?.latest_weekly) && modules.latest_weekly.length > 0)
    || (Array.isArray(modules?.featured_series) && modules.featured_series.length > 0)
}

/** Supplementary sections load independently of the homepage's lead stories. */
export default function useNewsroomData(enabled, bootstrapModules, bootstrapTopics, managedHome = {}) {
  const managed = managedHome.managed === true
  const [modules, setModules] = useState(null)
  const [topics, setTopics] = useState(null)
  const [loading, setLoading] = useState(Boolean(enabled))
  const [error, setError] = useState('')
  const [modulesError, setModulesError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const bootstrapRef = useRef(null)
  const bootstrapTopicsRef = useRef(null)

  // Bootstrap may arrive after mount. Empty objects must neither discard usable
  // content nor become effect dependencies that repeatedly restart both requests.
  if (hasEditorialModules(bootstrapModules)) bootstrapRef.current = bootstrapModules
  if (Array.isArray(bootstrapTopics) && bootstrapTopics.length > 0) bootstrapTopicsRef.current = bootstrapTopics

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    if (!enabled || managed) return undefined
    let active = true
    setLoading(true)
    setError('')
    setModulesError('')

    // Keep the API client's shared cache and request deduplication. A consumer's
    // cleanup only ignores its own results; it must not abort a shared request.
    const modulesRequest = fetchHomeModules().then((result) => {
      if (active) setModules(result)
    })
    const topicsRequest = fetchTopics({ limit: 4 }).then((result) => {
      if (active) setTopics(result.items)
    })

    Promise.allSettled([modulesRequest, topicsRequest]).then((results) => {
      if (!active) return
      const failures = results.flatMap((result, index) => result.status === 'rejected'
        ? [index === 0 ? '周报与专栏' : '追踪专题'] : [])
      setError(failures.length ? `${failures.join('、')}暂时无法加载，请稍后重试。` : '')
      setModulesError(results[0].status === 'rejected' ? '周报与专栏暂时无法加载，请稍后重试。' : '')
      setLoading(false)
    })

    return () => { active = false }
  }, [enabled, managed, attempt])

  // A complete homepage snapshot is verified together. Do not launch duplicate
  // modules/topics requests or let a nonempty ref resurrect an authoritative []
  // after an editor has removed a topic or series.
  if (managed) return {
    modules: bootstrapModules ?? null,
    topics: Array.isArray(bootstrapTopics) ? bootstrapTopics : null,
    loading: Boolean(enabled && managedHome.loading),
    error: managedHome.error || '',
    modulesError: managedHome.error || '',
    retry: managedHome.retry || retry,
  }

  return {
    modules: modules ?? bootstrapRef.current,
    topics: topics ?? bootstrapTopicsRef.current,
    loading: Boolean(enabled) && loading,
    error,
    modulesError,
    retry,
  }
}
