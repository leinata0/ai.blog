/** @vitest-environment node */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// React Router 7 changed how *relative* paths resolve inside splat routes (the old
// `v7_relativeSplatPath` flag): under v6 they resolved against the full matched URL
// including the splat, under v7 they resolve against the route's own path. `App.jsx`
// serves `<Route path="*" element={<NotFoundPage />} />` for every unknown URL, and
// `NotFoundPage` renders `Navbar` + `Footer` — i.e. most of the site's navigation is
// reachable from inside a splat route.
//
// The upgrade was safe only because every statically-resolvable router target in this
// app is absolute, so splat-relative resolution never applies. That is a property of our
// source, not of the library, and nothing else enforces it: a single `<Link to="series">`
// added under the catch-all would silently point somewhere different depending on the
// URL the visitor happened to 404 on. This test keeps that property true.

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url))

function collectSourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...collectSourceFiles(full))
      continue
    }
    if (!/\.(jsx|js)$/.test(entry.name) || /\.test\.(jsx|js)$/.test(entry.name)) continue
    found.push(full)
  }
  return found
}

// Only statically-resolvable targets are checked: a quote (or backtick) must follow
// immediately, so `to={tabHref(tab)}` / `navigate(libraryHref())` are skipped rather
// than guessed at. An empty capture means the literal opens with `${...}`, which is
// equally dynamic and also skipped.
const TARGET_PATTERNS = [
  { label: 'to', regex: /\bto=\{?(["'`])([^"'`$]*)/g },
  { label: 'navigate', regex: /\bnavigate\(\s*(["'`])([^"'`$]*)/g },
]

describe('router navigation targets', () => {
  it('keeps every static Link/navigate target absolute so splat routes cannot rewrite it', () => {
    const offenders = []

    for (const file of collectSourceFiles(SRC_DIR)) {
      const source = readFileSync(file, 'utf8')
      for (const { label, regex } of TARGET_PATTERNS) {
        regex.lastIndex = 0
        for (const match of source.matchAll(regex)) {
          const target = match[2]
          if (!target) continue
          if (target.startsWith('/')) continue
          offenders.push(`${file.slice(SRC_DIR.length + 1)}: ${label}="${target}"`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('scans a meaningful number of targets, so a broken regex cannot pass vacuously', () => {
    let matched = 0
    for (const file of collectSourceFiles(SRC_DIR)) {
      const source = readFileSync(file, 'utf8')
      for (const { regex } of TARGET_PATTERNS) {
        regex.lastIndex = 0
        for (const match of source.matchAll(regex)) {
          if (match[2]) matched += 1
        }
      }
    }
    expect(matched).toBeGreaterThan(60)
  })
})
