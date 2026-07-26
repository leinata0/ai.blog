#!/usr/bin/env node

// Replace the body of one existing post, identified by its exact slug.
//
// This used to carry a hard-coded SLUG plus a hard-coded ~9KB CONTENT_MD constant, so
// `node publish-article.mjs` with no arguments silently PUT that body over a live article
// on whatever BLOG_API_BASE pointed at. Both inputs are now required arguments, and the
// write itself is opt-in behind `--apply` (same convention as repair-post-media.mjs).
//
// Usage:
//   node publish-article.mjs --slug <post-slug> --file <path/to/body.md>            # dry run
//   node publish-article.mjs --slug <post-slug> --file <path/to/body.md> --apply    # writes

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  acquireAdminToken,
  fetchWithTransientRetry,
  iterateAdminPostPages,
  resolveAdminPassword,
  resolveAdminUsername,
  resolveBlogApiBase,
} from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()

export function parsePublishArticleArgs(argv = process.argv.slice(2)) {
  const options = {
    slug: String(process.env.POST_SLUG || '').trim(),
    file: String(process.env.CONTENT_FILE || '').trim(),
    dryRun: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--apply') options.dryRun = false
    else if (current === '--dry-run') options.dryRun = true
    else if (current === '--slug' && argv[index + 1]) options.slug = String(argv[++index]).trim()
    else if (current.startsWith('--slug=')) options.slug = current.slice('--slug='.length).trim()
    else if (current === '--file' && argv[index + 1]) options.file = String(argv[++index]).trim()
    else if (current.startsWith('--file=')) options.file = current.slice('--file='.length).trim()
  }

  return options
}

export function assertPublishArticleArgs(options = {}) {
  const slug = String(options.slug || '').trim()
  const file = String(options.file || '').trim()
  if (!slug) {
    throw new Error('Missing --slug (or POST_SLUG). Refusing to guess which post to overwrite.')
  }
  if (!file) {
    throw new Error('Missing --file (or CONTENT_FILE) pointing at the Markdown body to publish.')
  }
  return { slug, file, dryRun: options.dryRun !== false }
}

export async function loadContentMarkdown(file, { readFileImpl = readFile } = {}) {
  const path = isAbsolute(file) ? file : resolve(process.cwd(), file)
  const content = String(await readFileImpl(path, 'utf8')).trim()
  if (!content) throw new Error(`Content file is empty: ${path}`)
  return content
}

// Deliberately different from `lib/blog-api.mjs::findAdminPostByExactSlug`, which returns the
// first match and null when there is none. This script overwrites a live post body, so it scans
// to the end of the archive to prove the slug is unique and refuses to guess: missing and
// ambiguous are both hard errors. Only the paging itself is shared.
export async function findPostByExactSlug({
  slug,
  token,
  blogApiBase = BLOG_API_BASE,
  fetchImpl = fetch,
  pageSize = 50,
  maxPages = 1000,
  retryOptions,
}) {
  const matches = []
  let reachedEnd = false

  const pages = iterateAdminPostPages({ blogApiBase, token, pageSize, maxPages, fetchImpl, retryOptions })
  for await (const page of pages) {
    matches.push(...page.items.filter((post) => post?.slug === slug))
    if (matches.length > 1) throw new Error(`Multiple posts found for exact slug: ${slug}`)
    reachedEnd = page.last
  }

  if (!reachedEnd) throw new Error(`Failed to resolve exact slug within ${maxPages} pages: ${slug}`)
  if (matches.length === 0) throw new Error(`Post not found for exact slug: ${slug}`)
  return matches[0]
}

// `dryRun` defaults to false here because this is the explicit programmatic entry point —
// a caller that constructed a slug and a body already decided to write. The safety gate
// lives in the CLI layer (`parsePublishArticleArgs` defaults to a dry run and `main`
// requires --slug/--file), which is where the accidental-overwrite risk actually was.
export async function publishArticle({
  slug,
  contentMd,
  dryRun = false,
  blogApiBase = BLOG_API_BASE,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
  fetchImpl = fetch,
  sleepImpl,
  logger = console,
  acquireTokenImpl = acquireAdminToken,
} = {}) {
  if (!password) throw new Error('Missing ADMIN_PASSWORD')

  const host = (() => {
    try {
      return new URL(blogApiBase).host
    } catch {
      return blogApiBase
    }
  })()
  logger?.log?.(`Target: ${host} slug=${slug} mode=${dryRun ? 'dry-run' : 'APPLY'} body=${String(contentMd || '').length} chars`)

  // The `/readyz` probe inside `acquireAdminToken` runs before the credentialed login, so a
  // Render cold start is absorbed by a request that costs nothing and is not rate limited.
  // The 30s per-request timeout below stays: removing it would just trade an abort for a hang.
  const token = await acquireTokenImpl({
    blogApiBase,
    username,
    password,
    fetchImpl,
    ...(sleepImpl ? { sleepImpl } : {}),
    logger,
  })
  logger?.log?.('Login OK')

  const target = await findPostByExactSlug({ slug, token, blogApiBase, fetchImpl })
  if (!target?.id) throw new Error(`Post found for slug ${slug} but has no id`)

  if (dryRun) {
    logger?.log?.(`Dry run: would overwrite content_md of id=${target.id} slug=${slug}. Re-run with --apply to write.`)
    return { ...target, dry_run: true }
  }

  const updateResp = await fetchWithTransientRetry(
    fetchImpl,
    `${blogApiBase}/api/admin/posts/${target.id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content_md: contentMd }),
    },
    // A single attempt: this is a body-overwriting PUT and the wake gate above already removed
    // the cold start, so the only thing a retry could add here is a duplicate write.
    { attempts: 1, ...(sleepImpl ? { sleepImpl } : {}) },
  )
  if (!updateResp.ok) {
    throw new Error(`Post update failed: ${updateResp.status} ${(await updateResp.text()).slice(0, 300)}`)
  }
  logger?.log?.(`Content updated for slug=${slug} id=${target.id}`)
  return { ...target, dry_run: false }
}

async function main() {
  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')
  const { slug, file, dryRun } = assertPublishArticleArgs(parsePublishArticleArgs())
  const contentMd = await loadContentMarkdown(file)
  await publishArticle({ slug, contentMd, dryRun })
}

const __filename = fileURLToPath(import.meta.url)
const isMainModule = process.argv[1] ? resolve(process.argv[1]) === __filename : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
