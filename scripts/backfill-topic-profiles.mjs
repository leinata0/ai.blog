#!/usr/bin/env node

import { buildTopicMetadataPayload } from './auto-blog.mjs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const BLOG_API_BASE = (process.env.BLOG_API_BASE || 'https://ai-blog-hbur.onrender.com').replace(/\/$/, '')
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD

export function parseBackfillTopicArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    force: false,
    limit: 50,
    offset: 0,
    maxPages: 20,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--force') options.force = true
    else if (current === '--limit' && argv[index + 1]) options.limit = Number(argv[++index])
    else if (current.startsWith('--limit=')) options.limit = Number(current.split('=')[1])
    else if (current === '--offset' && argv[index + 1]) options.offset = Number(argv[++index])
    else if (current.startsWith('--offset=')) options.offset = Number(current.split('=')[1])
    else if (current === '--max-pages' && argv[index + 1]) options.maxPages = Number(argv[++index])
    else if (current.startsWith('--max-pages=')) options.maxPages = Number(current.split('=')[1])
  }

  options.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(options.limit, 200) : 50
  options.offset = Number.isFinite(options.offset) && options.offset >= 0 ? options.offset : 0
  options.maxPages = Number.isFinite(options.maxPages) && options.maxPages > 0 ? Math.min(options.maxPages, 200) : 20
  return options
}

export function buildBackfillTopicMetadata(post) {
  const topicKey = String(post?.topic_key || '').trim()
  if (!topicKey) return null

  const pseudoGate = {
    passed: true,
    metrics: {
      source_count: Number(post?.source_count || 0),
      high_quality_source_count: Math.max(0, Math.min(Number(post?.source_count || 0), Math.round(Number(post?.source_count || 0) * 0.5))),
      analysis_signal_count: 0,
      missing_sections: [],
    },
  }

  return buildTopicMetadataPayload({
    postId: post?.id,
    post,
    outline: {
      topic: post?.title || '',
      thesis: post?.summary || '',
    },
    metadata: {
      topic_key: topicKey,
      content_type: post?.content_type || 'post',
      coverage_date: post?.coverage_date || '',
    },
    gate: pseudoGate,
    researchPack: {
      sources: [],
    },
  })
}

async function getAdminToken() {
  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')
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

async function fetchAdminPosts(token, { limit, offset }) {
  const candidates = [
    `${BLOG_API_BASE}/api/admin/posts?limit=${limit}&offset=${offset}`,
    `${BLOG_API_BASE}/api/admin/posts?limit=${limit}&skip=${offset}`,
  ]
  for (const url of candidates) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) {
      if (resp.status === 404 || resp.status === 405) continue
      throw new Error(`Fetch posts failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
    }
    const data = await resp.json()
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : data?.posts || [])
    return Array.isArray(items) ? items : []
  }
  return []
}

async function upsertTopicProfile(token, payload) {
  const postId = Number(payload?.post_id)
  if (!Number.isFinite(postId)) return { ok: false, reason: 'missing_post_id' }
  const endpoints = [
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-metadata`,
      body: payload,
    },
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-profile`,
      body: payload,
    },
    {
      method: 'POST',
      url: `${BLOG_API_BASE}/api/admin/topic-metadata`,
      body: payload,
    },
  ]

  for (const endpoint of endpoints) {
    const resp = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(endpoint.body),
    })
    if (resp.ok) return { ok: true, endpoint: endpoint.url }
    if (resp.status === 404 || resp.status === 405) continue
    throw new Error(`Upsert topic metadata failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return { ok: false, reason: 'no_supported_endpoint' }
}

export async function runBackfillTopicProfiles(options = {}) {
  const args = {
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0,
    maxPages: Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : 20,
  }
  const token = await getAdminToken()
  const items = []

  for (let page = 0; page < args.maxPages; page += 1) {
    const currentOffset = args.offset + page * args.limit
    const posts = await fetchAdminPosts(token, { limit: args.limit, offset: currentOffset })
    if (!posts.length) break

    for (const post of posts) {
      const postId = Number(post?.id)
      if (!Number.isFinite(postId)) continue
      if (!args.force && post?.topic_metadata) {
        items.push({ post_id: postId, status: 'skipped_existing' })
        continue
      }
      const payload = buildBackfillTopicMetadata(post)
      if (!payload) {
        items.push({ post_id: postId, status: 'skipped_missing_topic_key' })
        continue
      }
      if (args.dryRun) {
        items.push({ post_id: postId, status: 'dry_run', topic_metadata: payload.topic_metadata })
        continue
      }
      const result = await upsertTopicProfile(token, payload)
      items.push({
        post_id: postId,
        status: result.ok ? 'updated' : 'skipped',
        reason: result.reason || '',
      })
    }
    if (posts.length < args.limit) break
  }

  return {
    dry_run: args.dryRun,
    processed_count: items.length,
    updated_count: items.filter((item) => item.status === 'updated').length,
    skipped_count: items.filter((item) => item.status.startsWith('skipped')).length,
    items,
  }
}

async function main() {
  const report = await runBackfillTopicProfiles(parseBackfillTopicArgs())
  console.log(JSON.stringify(report, null, 2))
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}
