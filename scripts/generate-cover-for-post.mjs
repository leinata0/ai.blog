#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { generatePostCoverViaAdminJob, imageGenerationJobImageUrl, imageGenerationJobSucceeded } from './lib/admin-image-generation.mjs'
import {
  buildPostCoverBrief,
  buildPromptContext,
  extractHeadings,
  sanitizeCoverPrompt,
} from './lib/cover-art.mjs'

export { buildPromptContext, extractHeadings, sanitizeCoverPrompt } from './lib/cover-art.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const POST_ID = Number(process.env.POST_ID || 0)
const MANUAL_COVER_PROMPT = String(process.env.COVER_PROMPT || '').trim()
const OVERWRITE_EXISTING_COVER = String(process.env.OVERWRITE_EXISTING_COVER || 'false').toLowerCase() === 'true'

export function buildHeuristicCoverPrompt(post) {
  return buildPostCoverBrief(post)
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

async function fetchAdminPost(postId, token) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`Fetch post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function generateCoverWithConfiguredProvider(postId, coverBrief, token) {
  const job = await generatePostCoverViaAdminJob({
    blogApiBase: BLOG_API_BASE,
    token,
    postId,
    coverBrief,
    overwrite: OVERWRITE_EXISTING_COVER,
  })
  if (!imageGenerationJobSucceeded(job)) {
    throw new Error(job.error || `Cover generation job failed: ${job.error_code || job.status || 'unknown_error'}`)
  }
  return imageGenerationJobImageUrl(job)
}

async function main() {
  if (!Number.isFinite(POST_ID) || POST_ID <= 0) {
    throw new Error('Missing or invalid POST_ID')
  }

  const token = await login()
  console.log('Admin login OK')

  const post = await fetchAdminPost(POST_ID, token)
  console.log(`Loaded post: ${post.title}`)

  if (post.cover_image && !OVERWRITE_EXISTING_COVER) {
    console.log('Post already has a cover image, skipping because overwrite is disabled.')
    return
  }

  const coverBrief = buildPostCoverBrief(post, { manualBrief: MANUAL_COVER_PROMPT })
  if (!coverBrief) {
    throw new Error('Failed to build cover brief')
  }
  console.log(`Using cover brief: ${coverBrief}`)

  const coverImage = await generateCoverWithConfiguredProvider(POST_ID, coverBrief, token)
  console.log(`Cover generated and updated via configured provider: ${coverImage}`)
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
