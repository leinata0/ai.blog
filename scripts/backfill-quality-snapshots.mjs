#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { buildQualitySnapshotPayload } from './auto-blog.mjs'
import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const REFERENCES_HEADING_RE = /^##\s*(references?|(?:\u53c2\u8003\u6765\u6e90))\s*$/im
const IMAGE_SOURCES_HEADING_RE = /^##\s*(image sources?|(?:\u56fe\u7247\u6765\u6e90))\s*$/im
const NEXT_HEADING_RE = /^##\s+/
const MARKDOWN_LINK_RE = /\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi
const RAW_URL_RE = /https?:\/\/[^\s)>]+/gi
const BULLET_PREFIX_RE = /^\s*(?:[-*+]|\d+\.)\s*/
const HIGH_QUALITY_SOURCE_HINTS = [
  'official',
  'official_blog',
  'company_blog',
  'research',
  'paper',
  'arxiv',
  'openai',
  'anthropic',
  'google',
  'meta',
  'microsoft',
  'deepmind',
  'huggingface',
  'semianalysis',
  'stratechery',
]

export function parseBackfillArgs(argv = process.argv.slice(2)) {
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

function collectMissingSections(post) {
  const content = String(post?.content_md || '')
  const checks = [
    { key: 'references', match: REFERENCES_HEADING_RE },
    { key: 'image_sources', match: IMAGE_SOURCES_HEADING_RE },
  ]
  return checks
    .filter((item) => !item.match.test(content))
    .map((item) => item.key)
}

function estimateAnalysisSignals(contentMd) {
  const text = String(contentMd || '').toLowerCase()
  const hints = [
    '\u5f71\u54cd',
    '\u53d6\u820d',
    '\u5bf9\u6bd4',
    'trade-off',
    'impact',
    'however',
    'but',
    'meanwhile',
  ]
  return hints.reduce((count, hint) => count + (text.includes(hint) ? 1 : 0), 0)
}

function extractSectionBody(contentMd, headingPattern) {
  const lines = String(contentMd || '').split(/\r?\n/)
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()))
  if (startIndex < 0) return ''

  const body = []
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (NEXT_HEADING_RE.test(line.trim())) break
    body.push(line)
  }
  return body.join('\n').trim()
}

function normalizeSourceEntry(value) {
  return String(value || '')
    .replace(BULLET_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsMarkdownLink(value) {
  return /\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i.test(String(value || ''))
}

function containsRawUrl(value) {
  return /https?:\/\/[^\s)>]+/i.test(String(value || ''))
}

function looksHighQualitySource(value) {
  const text = String(value || '').toLowerCase()
  return HIGH_QUALITY_SOURCE_HINTS.some((hint) => text.includes(hint))
}

export function inferReferenceMetrics(post) {
  const section = extractSectionBody(post?.content_md || '', REFERENCES_HEADING_RE)
  if (!section) {
    return { sourceCount: 0, highQualitySourceCount: 0, entries: [] }
  }

  const linkEntries = new Set()
  for (const match of section.matchAll(MARKDOWN_LINK_RE)) {
    const url = normalizeSourceEntry(match[1])
    if (url) linkEntries.add(url)
  }
  for (const match of section.matchAll(RAW_URL_RE)) {
    const url = normalizeSourceEntry(match[0])
    if (url) linkEntries.add(url)
  }

  const lineEntries = section
    .split(/\r?\n/)
    .map((line) => normalizeSourceEntry(line))
    .filter(Boolean)
    .filter((line) => !/^>\s*/.test(line))
    .filter((line) => !containsMarkdownLink(line))
    .filter((line) => !containsRawUrl(line))

  const entries = linkEntries.size > 0
    ? [...linkEntries]
    : [...new Set(lineEntries)]
  const sourceCount = entries.length
  const highQualitySourceCount = entries.filter((entry) => looksHighQualitySource(entry)).length

  return {
    sourceCount,
    highQualitySourceCount: Math.min(sourceCount, highQualitySourceCount),
    entries,
  }
}

export function buildBackfillGate(post) {
  const contentMd = String(post?.content_md || '')
  const inferred = inferReferenceMetrics(post)
  const sourceCount = Math.max(Number(post?.source_count || 0), inferred.sourceCount)
  const highQualitySourceCount = Math.max(
    0,
    Math.min(
      sourceCount,
      inferred.highQualitySourceCount || (sourceCount > 0 ? Math.max(1, Math.round(sourceCount * 0.5)) : 0)
    )
  )
  return {
    passed: true,
    reasons: [],
    metrics: {
      source_count: sourceCount,
      high_quality_source_count: highQualitySourceCount,
      char_count: contentMd.length,
      banned_phrase_hits: 0,
      analysis_signal_count: estimateAnalysisSignals(contentMd),
      missing_sections: collectMissingSections(post),
    },
  }
}

async function getAdminToken() {
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

async function fetchAdminPosts(token, { limit, offset }) {
  const page = Math.floor(offset / limit) + 1
  const candidates = [
    `${BLOG_API_BASE}/api/admin/posts?page=${page}&page_size=${limit}`,
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

async function upsertQualitySnapshot(token, payload) {
  if (!payload?.post_id) return { ok: false, reason: 'missing_post_id' }
  const postId = Number(payload.post_id)
  const endpoints = [
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/quality-snapshot`,
      body: payload,
    },
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/quality`,
      body: { quality_snapshot: payload.quality_snapshot },
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
    throw new Error(`Upsert quality snapshot failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return { ok: false, reason: 'no_supported_endpoint' }
}

export async function runBackfillQualitySnapshots(options = {}) {
  const args = {
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0,
    maxPages: Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : 20,
  }
  const token = await getAdminToken()
  const processed = []

  for (let page = 0; page < args.maxPages; page += 1) {
    const currentOffset = args.offset + page * args.limit
    const posts = await fetchAdminPosts(token, { limit: args.limit, offset: currentOffset })
    if (!posts.length) break

    for (const post of posts) {
      const postId = Number(post?.id)
      if (!Number.isFinite(postId)) continue
      if (!args.force && post?.quality_snapshot) {
        processed.push({ post_id: postId, status: 'skipped_existing' })
        continue
      }
      const metadata = {
        content_type: String(post?.content_type || 'post').trim(),
        topic_key: String(post?.topic_key || '').trim(),
        coverage_date: String(post?.coverage_date || '').trim(),
      }
      const gate = buildBackfillGate(post)
      const payload = buildQualitySnapshotPayload({
        postId,
        post,
        outline: { topic: post?.title || '', thesis: post?.summary || '' },
        metadata,
        gate,
        config: { quality_gate: {} },
        researchPack: { sources: [] },
      })
      if (args.dryRun) {
        processed.push({ post_id: postId, status: 'dry_run', quality_snapshot: payload.quality_snapshot })
        continue
      }
      const result = await upsertQualitySnapshot(token, payload)
      processed.push({
        post_id: postId,
        status: result.ok ? 'updated' : 'skipped',
        reason: result.reason || '',
      })
    }
    if (posts.length < args.limit) break
  }

  return {
    dry_run: args.dryRun,
    processed_count: processed.length,
    updated_count: processed.filter((item) => item.status === 'updated').length,
    skipped_count: processed.filter((item) => item.status.startsWith('skipped')).length,
    items: processed,
  }
}

async function main() {
  const options = parseBackfillArgs()
  const report = await runBackfillQualitySnapshots(options)
  console.log(JSON.stringify(report, null, 2))
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}
