import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// testing-library gives every `waitFor`/`findBy*` just 1000ms. That is a budget for how slow
// the *machine* is, not for how slow the code under test is, and 64 test files run in
// parallel: on a 2-4 core CI runner a correct assertion can lose the race purely because the
// worker was descheduled. That is precisely the "green locally, red on CI" class of failure
// this suite has already been bitten by.
//
// Reproduced here: with the repo's own suite under CPU contention, `feeds-page` and
// `public-pages-account-guard` (neither touched by this branch) each timed out on a `waitFor`
// whose condition was already satisfiable. Raising the ceiling cannot hide a real regression —
// a broken expectation never becomes true, it just reports 3s later — it only stops the runner
// from calling a slow machine a failing test.
configure({ asyncUtilTimeout: 3000 })

// Vitest runs with `globals: false`, so `afterEach` is not a global function.
// @testing-library/react only registers its automatic cleanup when it can see a
// global `afterEach` (or `teardown`) — with globals off that hook is silently
// never installed, and every test file that forgets an explicit `cleanup()`
// leaves its React trees mounted until the whole file is done.
//
// Those orphaned trees keep committing: `startTransition` updates fired from
// async `.then()` callbacks are scheduled on React's Scheduler (setImmediate)
// and can land after Vitest has torn the jsdom environment down, which throws
// "The `document` global was defined when React was initialized, but is not
// defined anymore" as an unhandled error. Because worker processes are reused
// across files, that error surfaces against whichever file happens to be
// running next — a false-positive risk for the entire suite.
//
// Register the cleanup that testing-library intended to install. It runs after
// each file's own `afterEach` hooks (Vitest unwinds hooks in reverse order), so
// tests that already clean up explicitly are unaffected.
afterEach(() => {
  cleanup()
})

if (typeof window !== 'undefined') {
  // jsdom does not implement window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  })
}
