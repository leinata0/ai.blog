import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Dependency security floors for all three packages (backend / frontend / scripts).
//
// The manifests use open lower bounds (`>=` in pyproject, `^` in package.json), so a
// stale resolver cache, a `--prefer-offline` install or a hand-edited lockfile can
// quietly walk a package *back* onto a version with a known advisory without anything
// failing. These tests pin the floor rather than the exact version: upgrades always
// pass, downgrades past a known-vulnerable release fail loudly.
//
// Every floor below is the first release that carries the fix, with the advisory that
// forced it. Raise a floor when a new advisory lands; never lower one.

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')

// Compares dotted numeric versions (PEP 440 / semver core). Non-numeric suffixes such
// as `-rc1` or `.post1` are ignored: they only ever appear on pre-releases we do not
// lock against, and treating them as 0 keeps the comparison conservative.
function compareVersions(a, b) {
  const parse = (v) => String(v).split(/[.+-]/).map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  const width = Math.max(left.length, right.length)
  for (let i = 0; i < width; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

function readUvLockVersions() {
  const raw = readFileSync(join(REPO_ROOT, 'backend', 'uv.lock'), 'utf8')
  const versions = new Map()
  // `\r?\n`, not `\n`: with git's `core.autocrlf=true` (the Windows default) uv.lock is
  // checked out with CRLF, the LF-only pattern matched nothing, and the test then reported
  // every pinned package as "missing from the lockfile" on developer machines while passing
  // on the Linux CI runner.
  for (const match of raw.matchAll(/^name = "([^"]+)"\r?\nversion = "([^"]+)"/gm)) {
    versions.set(match[1], match[2])
  }
  return versions
}

function readNpmLockVersions(pkgDir) {
  const raw = JSON.parse(readFileSync(join(REPO_ROOT, pkgDir, 'package-lock.json'), 'utf8'))
  const versions = new Map()
  for (const [path, meta] of Object.entries(raw.packages || {})) {
    if (!path.startsWith('node_modules/') || !meta.version) continue
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
    // Nested copies can differ from the hoisted one; keep the lowest so the floor
    // check fails if *any* copy in the tree is vulnerable.
    const existing = versions.get(name)
    if (!existing || compareVersions(meta.version, existing) < 0) versions.set(name, meta.version)
  }
  return versions
}

function assertFloors(versions, floors, label) {
  const violations = []
  for (const [name, { min, advisory }] of Object.entries(floors)) {
    const actual = versions.get(name)
    if (!actual) {
      violations.push(`${name} is missing from the ${label} lockfile`)
      continue
    }
    if (compareVersions(actual, min) < 0) {
      violations.push(`${name} ${actual} < ${min} (${advisory})`)
    }
  }
  assert.deepEqual(violations, [], `${label} dependencies below their security floor:\n${violations.join('\n')}`)
}

test('backend lockfile stays above the known-advisory floors', () => {
  assertFloors(
    readUvLockVersions(),
    {
      // Host header was not validated, so `request.url.path` could be poisoned and
      // path-based checks bypassed - /proxy-image SSRF guarding and rate limiting
      // both key off the path, so this one is load-bearing for this app.
      starlette: { min: '1.3.1', advisory: 'GHSA-86qp-5c8j-p5mr, GHSA-82w8-qh3p-5jfq, GHSA-wqp7-x3pw-xc5r' },
      'python-multipart': { min: '0.0.31', advisory: 'GHSA-pp6c-gr5w-3c5g, GHSA-5rvq-cxj2-64vf' },
      urllib3: { min: '2.7.0', advisory: 'GHSA-mf9v-mfxr-j63j, GHSA-qccp-gfcp-xxvc' },
      cryptography: { min: '48.0.1', advisory: 'GHSA-537c-gmf6-5ccf' },
      pyasn1: { min: '0.6.4', advisory: 'GHSA-8ppf-4f7h-5ppj, GHSA-hm4w-wwcw-mr6r' },
      aiohttp: { min: '3.14.1', advisory: 'aiohttp 3.14.x MODERATE set' },
      idna: { min: '3.15', advisory: 'GHSA-65pc-fj4g-8rjx' },
      click: { min: '8.3.3', advisory: 'PYSEC-2026-2132' },
    },
    'backend',
  )
})

test('bleach is gone from the backend: unused, and it carried an unfixed linkify ReDoS', () => {
  const pyproject = readFileSync(join(REPO_ROOT, 'backend', 'pyproject.toml'), 'utf8')
  assert.equal(
    /^\s*"bleach/m.test(pyproject),
    false,
    'bleach was re-added to pyproject.toml - it has no import anywhere in backend/ and ships an unfixed advisory',
  )
  assert.equal(readUvLockVersions().has('bleach'), false, 'bleach is back in uv.lock')
})

test('frontend lockfile stays above the known-advisory floors', () => {
  assertFloors(
    readNpmLockVersions('frontend'),
    {
      // server.fs.deny was bypassable via Windows alternative paths; this is a real
      // local-dev exposure on the Windows machines this repo is developed on. The
      // 5.x line never got a patch, so the floor is the 6.x fix.
      vite: { min: '6.4.3', advisory: 'GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3' },
      // Vitest UI server allowed arbitrary file reads. `npm test` runs `vitest run`
      // and never starts the UI, but the floor keeps the fixed version in the tree.
      vitest: { min: '3.2.6', advisory: 'GHSA-5xrq-8626-4rwp' },
      esbuild: { min: '0.25.0', advisory: 'GHSA-67mh-4wv8-2f99' },
    },
    'frontend',
  )
})

test('react-router stays on 7.18+, the only line where the open-redirect set is fixed', () => {
  // GHSA-337j-9hxr-rhxg (arbitrary constructor injection via `deserializeErrors()`) and
  // GHSA-wrjc-x8rr-h8h6 (backslash open redirect in `<Link>`/`useNavigate`, the
  // CVE-2025-68470 bypass) both land their only fix in 7.18.0 - the 6.x line was never
  // patched, so the frontend was migrated off v6 rather than left exposed. A third,
  // GHSA-2j2x-hqr9-3h42 (`//`-prefixed same-origin redirect), is fixed in 6.30.4/7.14.1
  // and is covered by the same floor.
  //
  // 7.18.x still carries GHSA-qwww-vcr4-c8h2 (RSC-mode CSRF, introduced 7.12.0, fixed
  // only in 8.3.0). It is unreachable here: the app never touches the unstable RSC APIs,
  // and react-router 8 requires React >= 19.2.7 while this frontend is on React 18. Do
  // not let `npm audit fix --force` "solve" it - that downgrades to 7.11.0 and hands
  // back the two advisories above, which are the ones this app can actually hit.
  const versions = readNpmLockVersions('frontend')
  for (const name of ['react-router', 'react-router-dom']) {
    const actual = versions.get(name)
    assert.ok(actual, `${name} is missing from the frontend lockfile`)
    assert.ok(
      compareVersions(actual, '7.18.0') >= 0,
      `${name} ${actual} < 7.18.0 (GHSA-337j-9hxr-rhxg, GHSA-wrjc-x8rr-h8h6, GHSA-2j2x-hqr9-3h42)`,
    )
  }
})

test('react-router 8 is only reachable once React itself is on 19.2.7+', () => {
  // The 8.x line is where GHSA-qwww-vcr4-c8h2 is fixed, but it hard-requires React 19
  // and drops the `react-router-dom` compat package that all 45 imports here use. This
  // records the blocker so the upgrade is a deliberate decision, not a surprise: if the
  // frontend ever moves to React 19, revisit the 8.x migration.
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'frontend', 'package.json'), 'utf8'))
  const reactRange = pkg.dependencies?.react || ''
  const major = Number.parseInt(String(reactRange).replace(/^\D+/, ''), 10)
  if (major >= 19) {
    assert.fail(
      'frontend is on React 19+, so react-router 8.3.0+ is now reachable - migrate off '
      + 'react-router-dom (removed in 8.x) and clear GHSA-qwww-vcr4-c8h2',
    )
  }
  assert.ok(
    pkg.dependencies?.['react-router-dom'],
    'react-router-dom is the compat entry every import in frontend/src uses; it must stay declared while React is on 18',
  )
})

test('fast-xml-parser stays on the parser-only path that makes its advisory unreachable', () => {
  // GHSA-gh4j-gqv2-49f6 is confined to XMLBuilder: it fails to escape `-->` and `]]>`
  // when *building* XML from JS objects. The pipeline only ever parses (RSS in
  // blogwatcher.mjs, Atom in arxiv.mjs), so the advisory is not reachable and we skip
  // the breaking 4.x -> 5.x upgrade. That exemption is only valid while nothing builds
  // XML, so this fails the moment XMLBuilder shows up and forces the upgrade decision.
  const offenders = []
  for (const entry of readdirSync(join(REPO_ROOT, 'scripts'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    const full = join(entry.parentPath || entry.path, entry.name)
    if (full === fileURLToPath(import.meta.url)) continue
    if (/\bXMLBuilder\b/.test(readFileSync(full, 'utf8'))) {
      offenders.push(full.slice(REPO_ROOT.length + 1))
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `XMLBuilder is now used in ${offenders.join(', ')} - fast-xml-parser must be upgraded to >=5.7.0 (GHSA-gh4j-gqv2-49f6)`,
  )
})
