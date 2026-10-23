const scenes = new WeakMap()

// The renderer and DOM choreography share a pose without inherited CSS updates.
// Weak keys retain the same object across pause effects and release detached scenes.
export function getEditionSceneState(element) {
  return element ? scenes.get(element) ?? null : null
}

export function ensureEditionSceneState(element) {
  let state = scenes.get(element)
  if (!state) {
    state = { progress: 0, pointerX: 0, pointerY: 0 }
    scenes.set(element, state)
  }
  return state
}
