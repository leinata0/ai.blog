import { afterEach, expect, it, vi } from 'vitest'
import { afterScenePaint, createSceneStartup } from '../src/utils/sceneStartup'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function startupFixture() {
  let eligible = false
  const queue = new Set()
  const load = vi.fn(() => ({ scene: 'module' }))
  const start = vi.fn()
  const onError = vi.fn()
  const options = {
    deferred: true, isEligible: () => eligible, load, start, onError,
    schedule: vi.fn((callback) => { queue.add(callback); return () => queue.delete(callback) }),
  }
  return { options, load, start, onError, queue, eligible: (value) => { eligible = value }, flush: () => { [...queue].forEach((callback) => { queue.delete(callback); callback() }) } }
}

it('does not import while ineligible and coalesces repeated visible notifications', async () => {
  const fixture = startupFixture()
  const startup = createSceneStartup(fixture.options)
  startup.sync()
  expect(fixture.load).not.toHaveBeenCalled()
  fixture.eligible(true)
  startup.sync()
  startup.sync()
  expect(fixture.queue.size).toBe(1)
  fixture.flush()
  await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledOnce())
  startup.sync()
  expect(fixture.queue.size).toBe(0)
  expect(fixture.load).toHaveBeenCalledOnce()
})

it('reuses an import completed offscreen without constructing until visible again', async () => {
  const fixture = startupFixture()
  let finishImport
  fixture.load.mockImplementation(() => new Promise((resolve) => { finishImport = resolve }))
  const startup = createSceneStartup(fixture.options)
  fixture.eligible(true)
  startup.sync()
  fixture.flush()
  await vi.waitFor(() => expect(fixture.load).toHaveBeenCalledOnce())
  fixture.eligible(false)
  startup.sync()
  finishImport({ scene: 'cached' })
  await Promise.resolve()
  await Promise.resolve()
  expect(fixture.start).not.toHaveBeenCalled()
  fixture.eligible(true)
  startup.sync()
  fixture.flush()
  await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledWith({ scene: 'cached' }))
  expect(fixture.load).toHaveBeenCalledOnce()
})

it('cancels pending work and ignores import completion after disposal', async () => {
  const fixture = startupFixture()
  let finishImport
  fixture.load.mockImplementation(() => new Promise((resolve) => { finishImport = resolve }))
  const startup = createSceneStartup(fixture.options)
  fixture.eligible(true)
  startup.sync()
  fixture.eligible(false)
  startup.sync()
  expect(fixture.queue.size).toBe(0)
  fixture.eligible(true)
  startup.sync()
  fixture.flush()
  await vi.waitFor(() => expect(fixture.load).toHaveBeenCalledOnce())
  startup.dispose()
  finishImport({ scene: 'unused' })
  await Promise.resolve()
  await Promise.resolve()
  expect(fixture.start).not.toHaveBeenCalled()
  startup.sync()
  expect(fixture.queue.size).toBe(0)
})

it('preserves immediate initialization when deferred startup is disabled', async () => {
  const fixture = startupFixture()
  const startup = createSceneStartup({ ...fixture.options, deferred: false })
  startup.sync()
  expect(fixture.options.schedule).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledOnce())
})

it('yields one frame then an idle callback and can cancel either stage', () => {
  let frame, idle
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestIdleCallback', vi.fn((callback) => { idle = callback; return 2 }))
  vi.stubGlobal('cancelIdleCallback', vi.fn())
  const callback = vi.fn()
  const cancelFrame = afterScenePaint(callback)
  cancelFrame()
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
  frame()
  expect(requestIdleCallback).not.toHaveBeenCalled()
  const cancelIdle = afterScenePaint(callback)
  frame()
  expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 700 })
  cancelIdle()
  idle()
  expect(callback).not.toHaveBeenCalled()
  expect(cancelIdleCallback).toHaveBeenCalledWith(2)
})

it('falls back to a cancellable timer when idle callbacks are unavailable', () => {
  vi.useFakeTimers()
  let frame
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('requestIdleCallback', undefined)
  const callback = vi.fn()
  const cancel = afterScenePaint(callback)
  frame()
  cancel()
  vi.runAllTimers()
  expect(callback).not.toHaveBeenCalled()
  afterScenePaint(callback)
  frame()
  vi.runAllTimers()
  expect(callback).toHaveBeenCalledOnce()
})
