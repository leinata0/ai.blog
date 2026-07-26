#!/usr/bin/env node

import { isAbsolute, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  acquireAdminToken,
  fetchWithTransientRetry,
  iterateAdminPostPages,
  resolveAdminPassword,
  resolveAdminUsername,
  resolveBlogApiBase,
} from './lib/blog-api.mjs'
import { buildPostCoverBrief } from './lib/cover-art.mjs'
import {
  generatePostCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

// The cold-start handling first written here is now `lib/blog-api.mjs`, shared by every script:
// the backend spins down when idle, so the first request of a run pays a 50s+ cold start, and a
// bare 30s timeout on the login hop aborted every cold-start run — precisely how this workflow
// started failing after timeouts were introduced. The fix is not a bigger number on every call,
// it is a cheap unauthenticated `/readyz` probe with its own long budget, run before anything
// credentialed; `acquireAdminToken` below is that probe plus the login.
//
// Re-exported so this module keeps the surface it introduced them with.
export {
  isTransientHttpStatus,
  isTransientNetworkError,
  loginWithRetry,
  waitForBackendAwake,
} from './lib/blog-api.mjs'

const ARTICLE_FILE = process.env.ARTICLE_FILE || './content/blog-migration-neon-r2.mjs'
const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()

// A Windows-absolute ARTICLE_FILE used to be handed straight to `new URL(raw, base)`. WHATWG
// parses the leading `C:` as a URL *scheme*, so the result is the opaque `c:\tmp\a.mjs` —
// protocol `c:`, not a `file:` URL, and not importable. (No characters are lost; the string
// survives verbatim. The defect is purely that it is no longer a file URL.)
// Resolve on the filesystem first, then convert.
export function resolveArticleFileUrl(articleFile = ARTICLE_FILE, baseDir = dirname(fileURLToPath(import.meta.url))) {
  const raw = String(articleFile || '').trim()
  if (!raw) throw new Error('ARTICLE_FILE is empty')
  if (/^file:\/\//i.test(raw)) return new URL(raw)
  const absolutePath = isAbsolute(raw) ? raw : resolve(baseDir, raw)
  return pathToFileURL(absolutePath)
}

async function loadArticle() {
  const mod = await import(resolveArticleFileUrl())
  return mod.default || mod.article || mod
}

export async function fetchExistingPostBySlug(
  slug,
  token,
  { blogApiBase = BLOG_API_BASE, fetchImpl = fetch, pageSize = 50, maxPages = 1000, retryOptions } = {},
) {
  // The unbounded `for (;;)` this replaced paged forever if the API kept returning full pages
  // (or a bad `total`); the shared iterator's `maxPages` ceiling makes that impossible, and its
  // `last` flag distinguishes "reached the end of the archive" from "hit the ceiling".
  const pages = iterateAdminPostPages({ blogApiBase, token, pageSize, maxPages, fetchImpl, retryOptions })
  let reachedEnd = false

  for await (const page of pages) {
    const existingPost = page.items.find((item) => item.slug === slug)
    if (existingPost) return existingPost
    reachedEnd = page.last
  }

  if (reachedEnd) return null
  throw new Error(`Failed to resolve slug within ${maxPages} pages: ${slug}`)
}

export function resolveExistingCover(article, existingPost) {
  return String(article.cover_image || existingPost?.cover_image || '').trim()
}

function normalizeArticle(article, coverImage) {
  return {
    title: String(article.title || '').trim(),
    slug: String(article.slug || '').trim(),
    summary: String(article.summary || '').trim(),
    content_md: String(article.content_md || '').trim(),
    tags: Array.isArray(article.tags) ? article.tags : [],
    cover_image: coverImage || String(article.cover_image || '').trim(),
    is_published: article.is_published !== false,
    is_pinned: article.is_pinned === true,
  }
}

// Upsert by slug: PUT the post found by `fetchExistingPostBySlug`, POST only when the slug is
// genuinely absent. Reruns of this workflow update the same row instead of creating copies,
// and the backend's unique slug constraint (409) is the backstop if the lookup ever misses.
export async function createOrUpdatePost(post, existingPost, token, {
  blogApiBase = BLOG_API_BASE,
  fetchImpl = fetch,
  retryOptions,
} = {}) {
  const url = existingPost
    ? `${blogApiBase}/api/admin/posts/${existingPost.id}`
    : `${blogApiBase}/api/admin/posts`
  const method = existingPost ? 'PUT' : 'POST'

  const resp = await fetchWithTransientRetry(
    fetchImpl,
    url,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(post),
    },
    retryOptions,
  )

  if (!resp.ok) {
    throw new Error(`${method} post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  return resp.json()
}

async function main() {
  // Fail fast on a missing secret rather than after a three-minute wake wait.
  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')

  const article = await loadArticle()
  if (!article.title || !article.slug || !article.content_md) {
    throw new Error('Article file is missing required fields')
  }

  console.log(`Loaded article: ${article.title}`)

  // Wake first, then log in: the credentialed call must only ever run against a warm instance.
  const token = await acquireAdminToken({
    blogApiBase: BLOG_API_BASE,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  })
  console.log('Admin login OK')

  const existingPost = await fetchExistingPostBySlug(article.slug, token)
  if (existingPost) {
    console.log(`Existing post found: id=${existingPost.id}`)
  } else {
    console.log('No existing post with the same slug, creating a new one')
  }

  const coverImage = resolveExistingCover(article, existingPost)
  const coverBrief = buildPostCoverBrief(article, {
    manualBrief: String(article.cover_brief || article.cover_prompt || '').trim(),
  })
  const payload = normalizeArticle(article, coverImage)
  const result = await createOrUpdatePost(payload, existingPost, token)

  if (!coverImage && coverBrief) {
    console.log('Generating cover with the configured image channel...')
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: BLOG_API_BASE,
      token,
      postId: result.id,
      coverBrief,
      overwrite: false,
    })
    if (!imageGenerationJobSucceeded(job)) {
      throw new Error(job.error || `Configured image channel failed: ${job.error_code || job.status || 'unknown_error'}`)
    }
    console.log(`Cover generated: ${imageGenerationJobImageUrl(job)}`)
  }

  console.log(`Post published successfully: id=${result.id} slug=${result.slug}`)
  console.log(`${BLOG_API_BASE}/api/posts/${result.slug}`)
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
