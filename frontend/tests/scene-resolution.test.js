import { expect, it } from 'vitest'
import { createSceneResolutionController, scenePixelRatio } from '../src/utils/sceneResolution'

it('caps decorative pixels while preserving the device ratio on lower-density screens', () => {
  expect(scenePixelRatio(1440, 900, 2)).toBe(1)
  expect(scenePixelRatio(390, 844, 3)).toBe(1)
  expect(scenePixelRatio(800, 600, 0.8)).toBe(0.8)
  const ratio = scenePixelRatio(3840, 2160, 2)
  expect(3840 * 2160 * ratio ** 2).toBeCloseTo(2_000_000)
  expect(scenePixelRatio(1440, 900, 2, 0.7)).toBe(0.7)
})

it('ignores isolated stalls and maintains quality at a stable 60 or 160 Hz', () => {
  for (const interval of [1000 / 60, 1000 / 160]) {
    const controller = createSceneResolutionController()
    controller.sample(5000)
    controller.sample(180)
    for (let time = 0; time < 8000; time += interval) controller.sample(interval)
    expect(controller.quality).toBe(1)
  }
})

it('bounds sustained overload and restores quality only after a long stable recovery', () => {
  const controller = createSceneResolutionController()
  const sampleFor = (duration, interval) => {
    for (let time = 0; time < duration; time += interval) controller.sample(interval)
  }
  sampleFor(1000, 40)
  expect(controller.quality).toBe(1)
  sampleFor(1000, 40)
  expect(controller.quality).toBe(0.85)
  sampleFor(8000, 40)
  expect(controller.quality).toBe(0.7)
  sampleFor(4000, 10)
  expect(controller.quality).toBe(0.7)
  sampleFor(8000, 10)
  expect(controller.quality).toBe(0.85)
  sampleFor(12000, 10)
  expect(controller.quality).toBe(1)
})

it('also adapts consistently very slow rendering instead of discarding every sample', () => {
  const controller = createSceneResolutionController()
  for (let frame = 0; frame < 20; frame += 1) controller.sample(300)
  expect(controller.quality).toBe(0.7)
})
