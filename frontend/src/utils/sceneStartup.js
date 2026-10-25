/** Yield a paint before spending idle time on the decorative WebGL scene. */
export function afterScenePaint(callback) {
  let active = true
  let frame = null
  let idle = null
  let timer = null
  const run = () => {
    idle = timer = null
    if (!active) return
    active = false
    callback()
  }
  frame = requestAnimationFrame(() => {
    frame = null
    if (!active) return
    if (typeof requestIdleCallback === 'function') idle = requestIdleCallback(run, { timeout: 700 })
    else timer = setTimeout(run, 0)
  })
  return () => {
    active = false
    if (frame !== null) cancelAnimationFrame(frame)
    if (idle !== null) cancelIdleCallback(idle)
    if (timer !== null) clearTimeout(timer)
  }
}

/** One startup per scene; imports may finish offscreen without allocating a GPU. */
export function createSceneStartup({ deferred, isEligible, load, start, onError, schedule = afterScenePaint }) {
  let disposed = false
  let started = false
  let importing = false
  let modulePromise = null
  let cancelPending = null
  const eligible = () => !disposed && (!deferred || isEligible())
  const run = () => {
    cancelPending = null
    if (!eligible() || importing || started) return
    importing = true
    modulePromise ??= Promise.resolve().then(load)
    modulePromise.then((module) => {
      importing = false
      if (!eligible() || started) return
      started = true
      start(module)
    }).catch((error) => { importing = false; if (!disposed) onError(error) })
  }
  return {
    sync() {
      if (disposed || started) return
      if (!eligible()) { cancelPending?.(); cancelPending = null; return }
      if (importing || cancelPending) return
      if (deferred) cancelPending = schedule(run)
      else run()
    },
    dispose() {
      disposed = true
      cancelPending?.()
      cancelPending = null
    },
  }
}
