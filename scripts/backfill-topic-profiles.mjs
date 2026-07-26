#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildTopicMetadataPayload } from './auto-blog.mjs'
import {
  acquireAdminToken,
  fetchAdminPostsByOffset,
  fetchWithTransientRetry,
  resolveAdminPassword,
  resolveAdminUsername,
  resolveBlogApiBase,
} from './lib/blog-api.mjs'
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

// Writing is opt-in. `repair-post-media.mjs` already uses this convention; having the
// backfill scripts default to writing meant `node backfill-topic-profiles.mjs` with no
// arguments rewrote every post's topic metadata on whatever BLOG_API_BASE points at
// (production, in CI). Dry run is the default; `--apply` is required to write.
export function parseBackfillTopicArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: true,
    force: false,
    withCover: false,
    limit: 50,
    offset: 0,
    maxPages: 20,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--apply') options.dryRun = false
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

// `workflow_dispatch` only: the login below is the first request of the run, so it is the one that
// pays the Render cold start. `acquireAdminToken` absorbs that with an unauthenticated `/readyz`
// probe (its own long budget, never throws) before any credential leaves the process.
export async function getAdminToken(options = {}) {
  return acquireAdminToken({
    blogApiBase: BLOG_API_BASE,
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    ...options,
  })
}

async function fetchAdminPosts(token, { limit, offset }) {
  return fetchAdminPostsByOffset({
    blogApiBase: BLOG_API_BASE,
    token,
    limit,
    offset,
  })
}

// `GET /api/admin/posts/{id}/topic-metadata` does not exist — the backend only registers
// PUT on that path, so every probe returned 405, the function returned null, and the
// "skip when a profile already exists" branch was permanently dead: each run rewrote
// every post's topic metadata. The list endpoint below is a real GET; it is fetched once
// and answers the existence question for the whole run.
export function collectStoredTopicProfileKeys(profiles = []) {
  return new Set(
    (Array.isArray(profiles) ? profiles : [])
      .filter((profile) => profile?.profile_exists !== false && profile?.is_virtual !== true)
      .map((profile) => String(profile?.topic_key || '').trim())
      .filter(Boolean)
  )
}

async function fetchStoredTopicProfileKeys(token, { fetchImpl = fetch, retryOptions } = {}) {
  const resp = await fetchWithTransientRetry(
    fetchImpl,
    `${BLOG_API_BASE}/api/admin/topic-profiles`,
    { headers: { Authorization: `Bearer ${token}` } },
    retryOptions,
  )
  // Anything other than success is a real failure. Previously 401/500 fell through the
  // same path as "not found" and was read as "no existing data" -> overwrite.
  if (!resp.ok) {
    throw new Error(`Fetch topic profiles failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  const data = await resp.json()
  const profiles = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])
  return collectStoredTopicProfileKeys(profiles)
}

async function upsertTopicProfile(token, payload) {
  const postId = Number(payload?.post_id)
  if (!Number.isFinite(postId)) return { ok: false, reason: 'missing_post_id' }
  // Verified against backend/app/routers/admin.py: PUT /posts/{id}/topic-metadata is the
  // canonical route (the /topic-profile alias and POST /topic-metadata target the same
  // handler), so a single call is enough — no endpoint probing.
  const url = `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-metadata`
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })
  if (resp.ok) return { ok: true, endpoint: url, data: await resp.json() }
  throw new Error(`Upsert topic metadata failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
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

export function describeBackfillTarget(blogApiBase = BLOG_API_BASE) {
  try {
    return new URL(String(blogApiBase)).host
  } catch {
    return String(blogApiBase || 'unknown')
  }
}

export async function runBackfillTopicProfiles(options = {}) {
  const args = {
    dryRun: options.dryRun === undefined ? true : Boolean(options.dryRun),
    force: Boolean(options.force),
    withCover: Boolean(options.withCover),
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0,
    maxPages: Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : 20,
  }
  const getTokenImpl = options.getAdminTokenImpl || getAdminToken
  const fetchPostsImpl = options.fetchAdminPostsImpl || fetchAdminPosts
  const fetchStoredKeysImpl = options.fetchStoredTopicProfileKeysImpl || fetchStoredTopicProfileKeys
  const loadConfigImpl = options.loadConfigImpl || loadAutoBlogConfig
  const upsertImpl = options.upsertTopicProfileImpl || upsertTopicProfile
  const logger = options.logger === undefined ? console : options.logger

  logger?.log?.(
    `Topic profile backfill target: ${describeBackfillTarget()} `
    + `(mode=${args.dryRun ? 'dry-run' : 'APPLY'}, force=${args.force}, with_cover=${args.withCover}, `
    + `max_scan=${args.maxPages * args.limit} post(s))`
  )

  const token = await getTokenImpl()
  const config = await loadConfigImpl()
  const storedTopicProfileKeys = await fetchStoredKeysImpl(token)
  const items = []

  for (let page = 0; page < args.maxPages; page += 1) {
    const currentOffset = args.offset + page * args.limit
    const posts = await fetchPostsImpl(token, { limit: args.limit, offset: currentOffset })
    if (!posts.length) break

    for (const post of posts) {
      const postId = Number(post?.id)
      if (!Number.isFinite(postId)) continue
      const postTopicKey = String(post?.topic_key || '').trim()
      if (!args.force && postTopicKey && storedTopicProfileKeys.has(postTopicKey)) {
        items.push({ post_id: postId, status: 'skipped_existing', topic_key: postTopicKey })
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

      const result = await upsertImpl(token, payload)
      if (result.ok && postTopicKey) storedTopicProfileKeys.add(postTopicKey)
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
  const args = parseBackfillTopicArgs()
  const report = await runBackfillTopicProfiles(args)
  console.log(JSON.stringify(report, null, 2))
  if (report.dry_run) {
    console.log(`Dry run: nothing was written to ${describeBackfillTarget()}. Re-run with --apply to persist.`)
  }
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}
