#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { buildPostCoverPrompt } from './lib/cover-art.mjs'
import {
  generatePostCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

const ARTICLE_FILE = process.env.ARTICLE_FILE || './content/blog-migration-neon-r2.mjs'
const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()

async function loadArticle() {
  const articleUrl = new URL(ARTICLE_FILE, import.meta.url)
  const mod = await import(articleUrl)
  return mod.default || mod.article || mod
}

async function login() {
  if (!ADMIN_PASSWORD) {
    throw new Error('Missing ADMIN_PASSWORD')
  }
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  })
  if (!resp.ok) {
    throw new Error(`Admin login failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return (await resp.json()).access_token
}

export async function fetchExistingPostBySlug(
  slug,
  token,
  { blogApiBase = BLOG_API_BASE, fetchImpl = fetch, pageSize = 50 } = {},
) {
  for (let page = 1; ; page += 1) {
    const listResp = await fetchImpl(`${blogApiBase}/api/admin/posts?page=${page}&page_size=${pageSize}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!listResp.ok) {
      throw new Error(`Failed to load admin posts: ${listResp.status} ${(await listResp.text()).slice(0, 300)}`)
    }

    const data = await listResp.json()
    const items = Array.isArray(data.items) ? data.items : []
    const existingPost = items.find((item) => item.slug === slug)
    if (existingPost) return existingPost

    const total = Number(data.total)
    const reachedKnownEnd = Number.isFinite(total) && page * pageSize >= total
    if (reachedKnownEnd || items.length < pageSize) return null
  }
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

async function createOrUpdatePost(post, existingPost, token) {
  const url = existingPost
    ? `${BLOG_API_BASE}/api/admin/posts/${existingPost.id}`
    : `${BLOG_API_BASE}/api/admin/posts`
  const method = existingPost ? 'PUT' : 'POST'

  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(30000),
  })

  if (!resp.ok) {
    throw new Error(`${method} post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  return resp.json()
}

async function main() {
  const article = await loadArticle()
  if (!article.title || !article.slug || !article.content_md) {
    throw new Error('Article file is missing required fields')
  }

  console.log(`Loaded article: ${article.title}`)
  const token = await login()
  console.log('Admin login OK')

  const existingPost = await fetchExistingPostBySlug(article.slug, token)
  if (existingPost) {
    console.log(`Existing post found: id=${existingPost.id}`)
  } else {
    console.log('No existing post with the same slug, creating a new one')
  }

  const coverImage = resolveExistingCover(article, existingPost)
  const normalizedCoverPrompt = buildPostCoverPrompt(article, {
    manualPrompt: String(article.cover_prompt || '').trim(),
  })
  const payload = normalizeArticle(article, coverImage)
  const result = await createOrUpdatePost(payload, existingPost, token)

  if (!coverImage && normalizedCoverPrompt) {
    console.log('Generating cover with the configured image channel...')
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: BLOG_API_BASE,
      token,
      postId: result.id,
      prompt: normalizedCoverPrompt,
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
