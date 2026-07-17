#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTopicMetadataPayload } from './auto-blog.mjs'
import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import {
  generateTopicCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')
const DEFAULT_TOPIC_PRESENTATION_RULES_PATH = resolve(__dirname, 'config', 'topic-presentation.rules.json')

export function parseBackfillTopicArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    force: false,
    withCover: false,
    limit: 50,
    offset: 0,
    maxPages: 20,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--force') options.force = true
    else if (current === '--with-cover') options.withCover = true
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

function resolveTopicPresentationRulesPath(rawConfig = {}) {
  const configuredPath = rawConfig?.topic_presentation?.rules_path || process.env.AUTO_BLOG_TOPIC_PRESENTATION_RULES_PATH || ''
  if (!configuredPath) return DEFAULT_TOPIC_PRESENTATION_RULES_PATH
  if (isAbsolute(configuredPath)) return configuredPath
  return resolve(dirname(CONFIG_PATH), configuredPath)
}

function normalizeTopicPresentationConfig(rawConfig = {}, rulesConfig = {}) {
  const root = rawConfig?.topic_presentation || {}
  return {
    enabled: Boolean(root.enabled ?? true),
    rules: Array.isArray(rulesConfig?.rules) ? rulesConfig.rules : [],
    default_presentation: {
      zh_title_template: String(root?.default_presentation?.zh_title_template || '').trim(),
      zh_subtitle_template: String(root?.default_presentation?.zh_subtitle_template || '').trim(),
      zh_description_template: String(root?.default_presentation?.zh_description_template || '').trim(),
      zh_tags: Array.isArray(root?.default_presentation?.zh_tags)
        ? root.default_presentation.zh_tags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
    },
  }
}

async function loadAutoBlogConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  try {
    const rulesPath = resolveTopicPresentationRulesPath(parsed)
    const rulesRaw = await readFile(rulesPath, 'utf8')
    const rulesConfig = JSON.parse(rulesRaw)
    parsed.topic_presentation = normalizeTopicPresentationConfig(parsed, rulesConfig)
  } catch {
    parsed.topic_presentation = normalizeTopicPresentationConfig(parsed, {})
  }
  return parsed
}

export function buildBackfillTopicMetadata(post, config = {}) {
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
    config,
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

async function fetchExistingTopicMetadata(token, postId) {
  const candidates = [
    `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-metadata`,
    `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-profile`,
  ]
  for (const url of candidates) {
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (resp.ok) {
      const data = await resp.json()
      return data?.topic_metadata || data || {}
    }
    if (resp.status === 404 || resp.status === 405) continue
  }
  return null
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
    if (resp.ok) return { ok: true, endpoint: endpoint.url, data: await resp.json() }
    if (resp.status === 404 || resp.status === 405) continue
    throw new Error(`Upsert topic metadata failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return { ok: false, reason: 'no_supported_endpoint' }
}

function buildTopicCoverPrompt(payload) {
  const topic = payload?.topic_metadata || {}
  return [
    'Editorial hero image for a Chinese AI topic profile.',
    `Topic: ${topic.topic_zh_title || topic.topic_title || payload?.topic_key || 'AI topic'}.`,
    topic.topic_zh_subtitle ? `Subtitle: ${topic.topic_zh_subtitle}.` : '',
    topic.primary_thesis ? `Thesis: ${topic.primary_thesis}.` : '',
    'No text overlay, no watermark, modern cinematic style, wide landscape banner.',
  ].filter(Boolean).join(' ')
}

async function generateTopicCover(payload, profileId, token, overwrite) {
  const job = await generateTopicCoverViaAdminJob({
    blogApiBase: BLOG_API_BASE,
    token,
    targetId: profileId,
    prompt: buildTopicCoverPrompt(payload),
    overwrite,
  })
  if (!imageGenerationJobSucceeded(job)) {
    throw new Error(job.error || `Configured image channel failed: ${job.error_code || job.status || 'unknown_error'}`)
  }
  return imageGenerationJobImageUrl(job)
}

export async function runBackfillTopicProfiles(options = {}) {
  const args = {
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    withCover: Boolean(options.withCover),
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0,
    maxPages: Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : 20,
  }
  const token = await getAdminToken()
  const config = await loadAutoBlogConfig()
  const items = []

  for (let page = 0; page < args.maxPages; page += 1) {
    const currentOffset = args.offset + page * args.limit
    const posts = await fetchAdminPosts(token, { limit: args.limit, offset: currentOffset })
    if (!posts.length) break

    for (const post of posts) {
      const postId = Number(post?.id)
      if (!Number.isFinite(postId)) continue
      const existingTopicProfile = await fetchExistingTopicMetadata(token, postId)
      if (!args.force && existingTopicProfile) {
        items.push({ post_id: postId, status: 'skipped_existing' })
        continue
      }

      const payload = buildBackfillTopicMetadata(post, config)
      if (!payload) {
        items.push({ post_id: postId, status: 'skipped_missing_topic_key' })
        continue
      }

      const shouldGenerateCover = args.withCover
        && !String(post?.cover_image || '').trim()
        && !String(payload.topic_metadata?.topic_cover_image || '').trim()
      if (shouldGenerateCover && args.dryRun) {
        payload.topic_metadata.topic_cover_image = '__DRY_RUN_GENERATE__'
      }

      if (args.dryRun) {
        items.push({ post_id: postId, status: 'dry_run', topic_metadata: payload.topic_metadata })
        continue
      }

      const result = await upsertTopicProfile(token, payload)
      let coverImage = ''
      let coverError = ''
      if (result.ok && shouldGenerateCover) {
        try {
          coverImage = await generateTopicCover(payload, result.data?.profile_id, token, args.force)
        } catch (error) {
          coverError = error.message
        }
      }
      items.push({
        post_id: postId,
        status: result.ok ? 'updated' : 'skipped',
        reason: result.reason || coverError,
        cover_status: shouldGenerateCover ? (coverImage ? 'updated' : 'failed') : 'not_requested',
        cover_image: coverImage,
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
