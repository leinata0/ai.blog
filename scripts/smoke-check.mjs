#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

import { waitForBackendAwake } from './lib/blog-api.mjs'

const REQUIRED_ENV = ['PUBLIC_SITE_URL', 'BLOG_API_BASE']
const REQUEST_TIMEOUT_MS = 15000

// This script POSTs ADMIN_USERNAME/ADMIN_PASSWORD in cleartext to
// `${BLOG_API_BASE}/api/admin/login`, and BLOG_API_BASE comes from the environment.
// Anything able to set that variable (a workflow_dispatch input, a local shell, another
// script importing this module) could otherwise redirect production credentials to an
// attacker-controlled host. `.github/workflows/smoke-check.yml` now sources the base from
// `vars.BLOG_API_BASE` instead of a free-text input; the checks below are the second line
// of defence so the script stays safe no matter who invokes it. Note that the workflow
// deliberately does NOT pass ALLOWED_SMOKE_HOSTS, so the allowlist cannot be widened from
// the Actions UI.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const DEFAULT_ALLOWED_ADMIN_HOSTS = ['ai-blog-hbur.onrender.com', 'www.563118077.xyz', '563118077.xyz']

/**
 * Compare hosts the way DNS does: case-insensitive, trailing root dot optional, IPv6 literals
 * with or without the URL brackets and zone id. Applied to both sides of the allowlist so an
 * entry spelled `Example.COM.` or `[::1]` cannot silently stop matching — a stale-looking
 * allowlist that never matches is safe, but an allowlist an operator *thinks* is active is not.
 * Mirrors lib/url-guard.mjs::normalizeHostname; kept local so the credential guard has no
 * dependency that could be swapped out from under it.
 */
function normalizeHost(value) {
  let host = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1).replace(/%.*$/, '')
  }
  return host
}

/**
 * Hosts allowed to receive admin credentials.
 * `ALLOWED_SMOKE_HOSTS` (comma separated) replaces the built-in production hosts so a fork
 * can point at its own backend — and so an operator can narrow the list — while loopback
 * is always permitted for local runs. An empty/blank value keeps the built-in production
 * hosts rather than authorising everything, and entries that are not bare hostnames
 * (`*`, a full URL, `host:port`) simply never match: every degenerate input fails closed.
 */
export function resolveAllowedAdminHosts(env = process.env) {
  const configured = String(env.ALLOWED_SMOKE_HOSTS || '')
    .split(',')
    .map((value) => normalizeHost(value))
    .filter(Boolean)
  return new Set([...(configured.length > 0 ? configured : DEFAULT_ALLOWED_ADMIN_HOSTS), ...LOOPBACK_HOSTS])
}

/**
 * Refuse to send admin credentials anywhere that is not both transport-secure and
 * explicitly approved. Throws with an actionable message; callers exit non-zero.
 */
export function assertSafeAdminTarget(baseUrl, { allowedHosts = resolveAllowedAdminHosts() } = {}) {
  let parsed
  try {
    parsed = new URL(String(baseUrl || ''))
  } catch {
    throw new Error(`Refusing admin smoke: BLOG_API_BASE is not a valid URL (${baseUrl})`)
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Refusing admin smoke: unsupported protocol ${parsed.protocol} in BLOG_API_BASE`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Refusing admin smoke: BLOG_API_BASE must not embed credentials')
  }

  const approved = new Set([...allowedHosts].map((value) => normalizeHost(value)).filter(Boolean))
  const host = normalizeHost(parsed.hostname)
  const isLoopback = LOOPBACK_HOSTS.has(host)

  if (parsed.protocol !== 'https:' && !isLoopback) {
    throw new Error(
      `Refusing to send admin credentials over ${parsed.protocol}// to "${host}"; https is required outside localhost`,
    )
  }
  if (!approved.has(host)) {
    throw new Error(
      `Refusing to send admin credentials to unapproved host "${host}". ` +
        `Allowed: ${[...approved].join(', ')}. Set ALLOWED_SMOKE_HOSTS to authorise a different backend.`,
    )
  }

  return parsed
}

async function expectOk(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`)
  }
  return response
}

async function expectJson(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status} ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${url} -> invalid JSON: ${text.slice(0, 200)}`)
  }
}

export async function main(env = process.env, { fetchImpl = fetch, waitForBackendAwakeImpl = waitForBackendAwake } = {}) {
  for (const key of REQUIRED_ENV) {
    if (!env[key]?.trim()) {
      throw new Error(`Missing required env: ${key}`)
    }
  }

  const publicSiteUrl = env.PUBLIC_SITE_URL.replace(/\/$/, '')
  const blogApiBase = env.BLOG_API_BASE.replace(/\/$/, '')
  const adminUsername = env.ADMIN_USERNAME?.trim() || ''
  const adminPassword = env.ADMIN_PASSWORD?.trim() || ''
  const includeAdmin = env.INCLUDE_ADMIN_SMOKE === '1'

  // Validate before the first byte leaves the process. Running the public probes first would
  // already hand an unapproved BLOG_API_BASE five requests (and confirm the run is live) before
  // anything refused it, so an admin run aborts here rather than mid-flight.
  if (includeAdmin) {
    if (!adminUsername || !adminPassword) {
      throw new Error('Admin smoke requested but ADMIN_USERNAME/ADMIN_PASSWORD missing')
    }
    assertSafeAdminTarget(blogApiBase, { allowedHosts: resolveAllowedAdminHosts(env) })
  }

  // Absorb a Render cold start before the first assertion runs. Every probe below has a 15s
  // budget, which a sleeping instance blows through routinely — without this gate the smoke check
  // reports the backend as broken when the only thing wrong is that nobody had woken it. The
  // probe is unauthenticated and never throws, so it can safely precede the credential guard's
  // subjects; note it runs *after* the guard above, so an unapproved base still sends nothing.
  await waitForBackendAwakeImpl({ blogApiBase, fetchImpl })

  const publicChecks = [
    `${publicSiteUrl}/`,
    `${blogApiBase}/api/health`,
    `${blogApiBase}/api/settings`,
    `${blogApiBase}/api/stats`,
    `${blogApiBase}/api/public/home-bootstrap`,
  ]

  for (const url of publicChecks) {
    await expectOk(url, {}, fetchImpl)
  }

  if (!includeAdmin) {
    console.log('[smoke] Public checks passed')
    return
  }

  // Re-assert on the line that serialises the credentials, so refactoring the block above can
  // never quietly move the only check away from the request that actually carries them.
  assertSafeAdminTarget(blogApiBase, { allowedHosts: resolveAllowedAdminHosts(env) })

  const login = await expectJson(
    `${blogApiBase}/api/admin/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, password: adminPassword }),
    },
    fetchImpl,
  )

  const token = login.access_token
  if (!token) {
    throw new Error('Admin login succeeded without access token')
  }

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  }

  await expectJson(`${blogApiBase}/api/admin/posts?page_size=1`, { headers: authHeaders }, fetchImpl)
  await expectJson(`${blogApiBase}/api/admin/cover-generation-status`, { headers: authHeaders }, fetchImpl)
  await expectJson(`${blogApiBase}/api/admin/ai-provider-sources`, { headers: authHeaders }, fetchImpl)
  await expectJson(`${blogApiBase}/api/admin/ai-model-instances`, { headers: authHeaders }, fetchImpl)
  await expectJson(`${blogApiBase}/api/admin/ai-runtime-plan`, { headers: authHeaders }, fetchImpl)

  console.log('[smoke] Public + admin checks passed')
}

const isMainModule = process.argv[1] ? pathToFileURL(process.argv[1]).href === import.meta.url : false

if (isMainModule) {
  main().catch((error) => {
    console.error(`[smoke] ${error.message}`)
    process.exit(1)
  })
}
