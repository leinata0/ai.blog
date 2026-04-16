#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildImageSourcesSection,
  insertImagesIntoContent,
  normalizePublishedAt,
} from './auto-blog.mjs'
import { pickSourceImages } from './lib/source-image-picker.mjs'
import { buildHeuristicCoverPrompt } from './generate-cover-for-post.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BLOG_API_BASE = (process.env.BLOG_API_BASE || 'https://ai-blog-hbur.onrender.com').replace(/\/$/, '')
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')
const DEFAULT_POST_SLUG = 'ai-brief-2026-04-16-building-trust-era-privacy-led-ux'

const REFERENCES_HEADING_RE = /^##\s*(?:参考来源|references?)\s*$/im
const IMAGE_SOURCES_HEADING_RE = /^##\s*(?:图片来源|image sources?)\s*$/im
const NEXT_H2_RE = /^##\s+/i
const MARKDOWN_LINK_RE = /^\s*[-*+]\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\s*-\s*(.*))?$/i

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    slug: DEFAULT_POST_SLUG,
    postId: 0,
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--slug' && argv[index + 1]) options.slug = String(argv[++index] || '').trim()
    else if (current.startsWith('--slug=')) options.slug = String(current.split('=')[1] || '').trim()
    else if (current === '--post-id' && argv[index + 1]) options.postId = Number(argv[++index])
    else if (current.startsWith('--post-id=')) options.postId = Number(current.split('=')[1])
  }

  options.postId = Number.isFinite(options.postId) && options.postId > 0 ? options.postId : 0
  options.slug = String(options.slug || '').trim() || DEFAULT_POST_SLUG
  return options
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  return JSON.parse(raw)
}

async function adminLogin() {
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

async function fetchPublicPostBySlug(slug) {
  const resp = await fetch(`${BLOG_API_BASE}/api/posts/${slug}`, {
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`Fetch post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function fetchAdminPost(postId, token) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`Fetch admin post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

function extractSectionBody(contentMd, headingPattern) {
  const lines = String(contentMd || '').split(/\r?\n/)
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (startIndex < 0) return ''

  const body = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (NEXT_H2_RE.test(line.trim())) break
    body.push(line)
  }
  return body.join('\n').trim()
}

function inferSourceNameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    const label = hostname.split('.').slice(0, -1).join(' ') || hostname
    return label
      .split(/[-.\s]+/)
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(' ')
  } catch {
    return 'Unknown'
  }
}

function inferSourceTypeFromUrl(url) {
  const hostname = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (!hostname) return 'rss'
  if (hostname.includes('openai') || hostname.includes('anthropic') || hostname.includes('google') || hostname.includes('meta')) {
    return 'official_blog'
  }
  if (hostname.includes('arxiv') || hostname.includes('nature') || hostname.includes('science')) {
    return 'paper'
  }
  return 'rss'
}

function parseSourceTail(tail, url) {
  const parts = String(tail || '')
    .split(' - ')
    .map((part) => part.trim())
    .filter(Boolean)

  const sourceLabel = parts[0] || ''
  const [sourceNameRaw, sourceTypeRaw] = sourceLabel.split('/').map((part) => String(part || '').trim())
  const sourceName = sourceNameRaw || inferSourceNameFromUrl(url)
  const sourceType = sourceTypeRaw || inferSourceTypeFromUrl(url)
  const publishedAt = normalizePublishedAt(parts[1] || '')

  return {
    source_name: sourceName,
    source_type: sourceType,
    published_at: publishedAt,
  }
}

function extractSourcesFromReferences(contentMd) {
  const section = extractSectionBody(contentMd, REFERENCES_HEADING_RE)
  if (!section) return []

  const seen = new Set()
  const sources = []

  for (const line of section.split(/\r?\n/)) {
    const match = line.match(MARKDOWN_LINK_RE)
    if (!match) continue
    const [, title, url, tail = ''] = match
    if (!url || seen.has(url)) continue
    seen.add(url)
    const meta = parseSourceTail(tail, url)
    sources.push({
      title: String(title || '').trim() || meta.source_name,
      url,
      source_url: url,
      source_name: meta.source_name,
      source_type: meta.source_type,
      published_at: meta.published_at,
      is_primary: sources.length === 0,
    })
  }

  return sources
}

function extractImageTargetSections(contentMd, maxImages) {
  return String(contentMd || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^##\s+(.*)$/)?.[1]?.trim() || '')
    .filter(Boolean)
    .filter((heading) => !/^(参考来源|图片来源|references?|image sources?|一句话结论)$/i.test(heading))
    .slice(0, maxImages)
}

function replaceOrAppendImageSourcesSection(contentMd, imagePlans) {
  const nextSection = buildImageSourcesSection(imagePlans)
  const lines = String(contentMd || '').split(/\r?\n/)
  const startIndex = lines.findIndex((line) => IMAGE_SOURCES_HEADING_RE.test(line.trim()))

  if (startIndex < 0) {
    return `${String(contentMd || '').trim()}\n\n${nextSection}`.trim()
  }

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (NEXT_H2_RE.test(lines[index].trim())) {
      endIndex = index
      break
    }
  }

  const before = lines.slice(0, startIndex).join('\n').trimEnd()
  const after = lines.slice(endIndex).join('\n').trimStart()
  return [before, nextSection, after].filter(Boolean).join('\n\n')
}

async function upsertPublishingMetadata(token, payload) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/publishing-metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    throw new Error(`Publishing metadata bridge failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function generatePostCover(token, postId, overwrite = false) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}/generate-cover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ overwrite }),
    signal: AbortSignal.timeout(60000),
  })
  if (!resp.ok) {
    throw new Error(`Generate post cover failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function updatePostContent(token, postId, contentMd) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content_md: contentMd }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    throw new Error(`Update post content failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function main() {
  const options = parseArgs()
  const config = await loadConfig()
  const publicPost = options.postId > 0
    ? null
    : await fetchPublicPostBySlug(options.slug)
  const token = options.dryRun && options.postId <= 0 ? null : await adminLogin()
  const post = options.postId > 0
    ? await fetchAdminPost(options.postId, token)
    : (options.dryRun ? publicPost : await fetchAdminPost(publicPost.id, token))

  console.log(`Loaded post ${post.id}: ${post.slug}`)

  const sources = extractSourcesFromReferences(post.content_md)
  if (sources.length === 0) {
    throw new Error('No reference sources were parsed from the post body.')
  }

  const artifactPayload = {
    workflow_key: post.content_type === 'weekly_review' ? 'weekly_review' : 'daily_auto',
    coverage_date: String(post.coverage_date || '').trim(),
    research_pack_summary: JSON.stringify({
      summary: 'repair-post-media rebuilt metadata from the published references section',
      source_count: sources.length,
      cover_prompt: buildHeuristicCoverPrompt(post),
    }),
    quality_gate_json: '{}',
    image_plan_json: '[]',
    candidate_topics_json: '[]',
    failure_reason: '',
  }
  const bridgePayload = {
    post_id: post.id,
    post_slug: post.slug,
    metadata: {
      source_count: sources.length,
    },
    post_sources: sources.map((source) => ({
      source_type: source.source_type,
      source_name: source.source_name,
      source_url: source.source_url,
      published_at: source.published_at,
      is_primary: Boolean(source.is_primary),
    })),
    publishing_artifact: artifactPayload,
  }

  if (options.dryRun) {
    console.log(JSON.stringify({
      post_id: post.id,
      post_slug: post.slug,
      source_count: sources.length,
      bridge_payload: bridgePayload,
    }, null, 2))
    return
  }

  const bridgeResult = await upsertPublishingMetadata(token, bridgePayload)
  console.log(`Publishing metadata repaired: sources=${bridgeResult.source_count} artifact=${bridgeResult.artifact_id}`)

  const coverResult = await generatePostCover(token, post.id, false)
  if (coverResult.generated) {
    console.log(`Post cover ready: ${coverResult.cover_image}`)
  } else {
    console.log(`Post cover not regenerated: ${coverResult.error_code || 'unknown'} ${coverResult.error || ''}`.trim())
  }

  const allowedTypes = new Set(config.image_selection_rules?.allowed_source_types || [])
  const sections = extractImageTargetSections(post.content_md, config.image_selection_rules?.max_images || 0)
  const imagePlans = await pickSourceImages({
    sections,
    topic: post.topic_key || post.title,
    sourceItems: sources.filter((source) => allowedTypes.size === 0 || allowedTypes.has(source.source_type)),
    config,
  })

  if (imagePlans.length === 0) {
    console.log('No qualified inline images were found. Post body remains unchanged.')
    return
  }

  const contentWithImages = insertImagesIntoContent(post.content_md, imagePlans)
  const nextContent = replaceOrAppendImageSourcesSection(contentWithImages, imagePlans)
  if (nextContent === post.content_md) {
    console.log('Inline image content is already up to date.')
    return
  }

  await updatePostContent(token, post.id, nextContent)
  console.log(`Updated post content with ${imagePlans.length} inline image(s).`)
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
