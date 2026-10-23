const QUALITY = [1, 0.85, 0.7]

// Keep the decorative canvas within a pixel budget. DOM text stays at native
// resolution, including on high-density displays.
export function scenePixelRatio(width, height, deviceRatio, quality = 1) {
  return Math.min(deviceRatio || 1, 1, Math.sqrt(2_000_000 / Math.max(1, width * height))) * quality
}

export function createSceneResolutionController() {
  let level = 0
  let duration = 0
  let frames = 0
  let slow = 0
  let fast = 0
  return {
    get quality() { return QUALITY[level] },
    sample(interval) {
      // Bound outliers; isolated long tasks cannot fill two slow windows, but
      // consistently very slow rendering must still be eligible for adaptation.
      if (!Number.isFinite(interval) || interval <= 0) return false
      duration += Math.min(interval, 250)
      frames += 1
      if (duration < 1000) return false
      const average = duration / frames
      duration = 0
      frames = 0
      slow = average > 24 ? slow + 1 : 0
      fast = average < 17 ? fast + 1 : 0
      if (slow >= 2 && level < QUALITY.length - 1) {
        level += 1
      } else if (fast >= 12 && level > 0) {
        level -= 1
      } else return false
      slow = 0
      fast = 0
      return true
    },
  }
}
