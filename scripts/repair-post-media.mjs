#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  buildImageSourcesSection,
  dedupeImagePlansAgainstUsed,
  extractInlineImageUrlsFromMarkdown,
  insertImagesIntoContent,
  normalizeImageUrlForDedupe,
  normalizePublishedAt,
  resolveImageDedupeConfig,
  resolveUsedImageRegistry,
} from './auto-blog.mjs'
import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { pickSourceImages } from './lib/source-image-picker.mjs'
import {
  downloadVerifiedImage,
  localizeImagePlans,
  uploadLocalizedImage,
} from './lib/image-localizer.mjs'
import { waitForImageGenerationJob } from './lib/admin-image-generation.mjs'
import { buildHeuristicCoverPrompt } from './generate-cover-for-post.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')
const DEFAULT_POST_SLUG = 'ai-brief-2026-04-16-building-trust-era-privacy-led-ux'

const REFERENCES_HEADING_RE = /^##\s*(?:参考来源|references?)\s*$/im
const IMAGE_SOURCES_HEADING_RE = /^##\s*(?:图片来源|image sources?)\s*$/im
const NEXT_H2_RE = /^##\s+/i
const MARKDOWN_LINK_RE = /^\s*[-*+]\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)(?:\s*-\s*(.*))?$/i

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    slug: DEFAULT_POST_SLUG,
    postId: 0,
    all: false,
    apply: false,
    dryRun: true,
    concurrency: 3,
    pageSize: 50,
  }
  let explicitDryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--all') options.all = true
    else if (current === '--apply') options.apply = true
    else if (current === '--dry-run') explicitDryRun = true
    else if (current === '--slug' && argv[index + 1]) options.slug = String(argv[++index] || '').trim()
    else if (current.startsWith('--slug=')) options.slug = String(current.split('=')[1] || '').trim()
    else if (current === '--post-id' && argv[index + 1]) options.postId = Number(argv[++index])
    else if (current.startsWith('--post-id=')) options.postId = Number(current.split('=')[1])
    else if (current === '--concurrency' && argv[index + 1]) options.concurrency = Number(argv[++index])
    else if (current.startsWith('--concurrency=')) options.concurrency = Number(current.split('=')[1])
    else if (current === '--page-size' && argv[index + 1]) options.pageSize = Number(argv[++index])
    else if (current.startsWith('--page-size=')) options.pageSize = Number(current.split('=')[1])
  }

  if (options.apply && explicitDryRun) throw new Error('--apply and --dry-run cannot be used together')
  // Writing is opt-in: anything that is not --apply stays an audit.
  options.dryRun = !options.apply
  options.postId = Number.isFinite(options.postId) && options.postId > 0 ? options.postId : 0
  options.slug = String(options.slug || '').trim() || DEFAULT_POST_SLUG
  options.concurrency = Math.max(1, Math.min(8, Math.floor(Number(options.concurrency) || 3)))
  options.pageSize = Math.max(1, Math.min(50, Math.floor(Number(options.pageSize) || 50)))
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
    signal: AbortSignal.timeout(15000),
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

async function fetchAdminPostWith(postId, token, fetchImpl = fetch) {
  const resp = await fetchImpl(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`Fetch admin post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function fetchAdminPost(postId, token) {
  return fetchAdminPostWith(postId, token, fetch)
}

const DEFAULT_MAX_LIST_PAGES = 200

async function fetchPublishedAdminPosts(token, {
  pageSize = 50,
  maxPages = DEFAULT_MAX_LIST_PAGES,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const posts = []
  // A missing/non-numeric `total` plus a permanently full page used to spin
  // forever and accumulate unbounded state; the page ceiling fails loudly instead.
  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams({
      is_published: 'true',
      page: String(page),
      page_size: String(pageSize),
    })
    const resp = await fetchImpl(`${BLOG_API_BASE}/api/admin/posts?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) {
      throw new Error(`Fetch admin posts failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
    }
    const payload = await resp.json()
    const items = Array.isArray(payload?.items) ? payload.items : []
    posts.push(...items)
    const total = Number(payload?.total)
    if (items.length === 0 || items.length < pageSize || (Number.isFinite(total) && posts.length >= total)) {
      return posts
    }
    if (page === maxPages) {
      logger?.warn?.(`Stopped paging published posts at the ${maxPages}-page ceiling; increase maxPages if the archive is larger.`)
    }
  }
  return posts
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items || [])
  const results = new Array(values.length)
  let cursor = 0
  const workerCount = Math.min(values.length, Math.max(1, Math.floor(Number(concurrency) || 1)))
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index], index)
    }
  }))
  return results
}

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/gi
// `[![badge](img)](href)` must be rewritten as a unit; replacing only the inner
// image leaves an empty-text link (`[](href)`) behind.
const LINKED_MARKDOWN_IMAGE_RE = /\[\s*!\[([^\]]*)\]\(\s*(https?:\/\/[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)\s*\]\(\s*([^)\s]*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gi
const ANY_MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/
const IMAGE_SOURCE_ENTRY_RE = /^\s*[-*+]\s*(.+?)\s*:\s*\[[^\]]*\]\([^)]*\)\s*$/
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/
// NUL can never appear in Markdown we publish, so it is a safe placeholder for
// "an image used to live here" while blank lines are being reconciled.
const REMOVED_IMAGE_TOKEN = '\u0000removed-image\u0000'

// Every trusted-host decision (batch rewrite, single-post strip, audits) reads
// this one function. Hard-coding a CDN literal made idempotency depend on the
// literal still being correct: rename the CDN and the next run treats every
// already-localized image as third-party, re-downloading and re-uploading it.
const TRUSTED_IMAGE_HOST_ENV_KEYS = [
  'TRUSTED_IMAGE_HOSTS',
  'R2_PUBLIC_BASE_URL',
  'IMAGE_CDN_BASE_URL',
  'VITE_IMAGE_DIRECT_BASES',
  'PUBLIC_IMAGE_BASE_URL',
]

export function resolveTrustedImageHosts({ env = process.env, blogApiBase = BLOG_API_BASE } = {}) {
  const hosts = new Set()
  const addHost = (rawValue) => {
    const value = String(rawValue || '').trim()
    if (!value) return
    try {
      hosts.add(new URL(value).hostname.toLowerCase().replace(/\.+$/, ''))
      return
    } catch {
      // Not a URL — fall through and accept a bare hostname entry.
    }
    if (/^[a-z0-9.-]+$/i.test(value)) hosts.add(value.toLowerCase().replace(/\.+$/, ''))
  }

  addHost(blogApiBase)
  for (const key of TRUSTED_IMAGE_HOST_ENV_KEYS) {
    for (const chunk of String(env?.[key] || '').split(/[,\s]+/)) addHost(chunk)
  }
  return hosts
}

function apiOriginHost(blogApiBase = BLOG_API_BASE) {
  try {
    return new URL(blogApiBase).hostname.toLowerCase().replace(/\.+$/, '')
  } catch {
    return ''
  }
}

function warnIfImageCdnUnconfigured(trustedHosts, logger) {
  const apiHost = apiOriginHost()
  const cdnHosts = [...trustedHosts].filter((host) => host && host !== apiHost)
  if (cdnHosts.length === 0) {
    logger?.warn?.(
      'No image CDN host is configured (set TRUSTED_IMAGE_HOSTS or R2_PUBLIC_BASE_URL). '
      + 'Already-localized images may be treated as third-party and re-uploaded on every run.',
    )
  }
}

function auditSafeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    // Query and fragment stay: signed CDN URLs are useless without them, and an
    // audit entry that cannot be re-fetched makes a removal unreviewable. Only
    // embedded credentials are stripped.
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return '[invalid URL]'
  }
}

// --- Markdown structure helpers -------------------------------------------------

// Splits Markdown into alternating prose / fenced-code regions. Concatenating
// `text` in order reproduces the input byte for byte.
export function splitMarkdownCodeRegions(contentMd) {
  const text = String(contentMd || '')
  const segments = []
  const openRe = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/gm
  let cursor = 0
  let open = openRe.exec(text)
  while (open) {
    const marker = open[1]
    const fenceChar = marker[0] === '`' ? '\\`' : '~'
    const closeRe = new RegExp(`^[ \\t]{0,3}${fenceChar}{${marker.length},}[ \\t]*(?:\\n|$)`, 'gm')
    closeRe.lastIndex = openRe.lastIndex
    const close = closeRe.exec(text)
    const blockEnd = close ? close.index + close[0].length : text.length
    if (open.index > cursor) segments.push({ code: false, text: text.slice(cursor, open.index) })
    segments.push({ code: true, text: text.slice(open.index, blockEnd) })
    cursor = blockEnd
    openRe.lastIndex = blockEnd
    open = openRe.exec(text)
  }
  if (cursor < text.length) segments.push({ code: false, text: text.slice(cursor) })
  return segments
}

function transformOutsideInlineCode(text, transform) {
  const pattern = /(`+)[\s\S]*?\1/g
  let result = ''
  let cursor = 0
  let match = pattern.exec(text)
  while (match) {
    result += transform(text.slice(cursor, match.index))
    result += match[0]
    cursor = pattern.lastIndex
    match = pattern.exec(text)
  }
  return result + transform(text.slice(cursor))
}

// Applies `transform` to prose only. Fenced blocks and inline code spans keep
// their bytes, so a documented `![demo](https://…)` example is never localized,
// removed, or reflowed.
export function transformMarkdownProse(contentMd, transform, { skipInlineCode = true } = {}) {
  return splitMarkdownCodeRegions(contentMd)
    .map((segment) => {
      if (segment.code) return segment.text
      return skipInlineCode ? transformOutsideInlineCode(segment.text, transform) : transform(segment.text)
    })
    .join('')
}

// Collapses only the blank lines the removals themselves created. The previous
// document-wide /\n{3,}/ pass rewrote unrelated (and code-block) whitespace and
// reported the post as changed.
function collapseRemovalGaps(text) {
  const pattern = new RegExp(
    `[^\\S\\n]*(?:\\n[^\\S\\n]*)*(?:${REMOVED_IMAGE_TOKEN}[^\\S\\n]*(?:\\n[^\\S\\n]*)*)+`,
    'g',
  )
  return text.replace(pattern, (match, offset, source) => {
    const leading = match.slice(0, match.indexOf(REMOVED_IMAGE_TOKEN))
    const trailing = match.slice(match.lastIndexOf(REMOVED_IMAGE_TOKEN) + REMOVED_IMAGE_TOKEN.length)
    const leadingBreaks = (leading.match(/\n/g) || []).length
    const trailingBreaks = (trailing.match(/\n/g) || []).length
    if (leadingBreaks === 0 && trailingBreaks === 0) return ''
    if (offset === 0) return ''
    if (offset + match.length >= source.length) return ''
    return '\n'.repeat(Math.min(2, Math.max(leadingBreaks, trailingBreaks)))
  })
}

function normalizeHeadingLabel(value) {
  return String(value || '').replace(/^#{1,6}\s*/, '').trim()
}

function collectHeadingImageState(contentMd) {
  const sections = new Map()
  let current = ''
  let fenceChar = ''
  let fenceLength = 0
  for (const line of String(contentMd || '').split('\n')) {
    const fence = FENCE_LINE_RE.exec(line)
    if (fence) {
      if (!fenceChar) {
        fenceChar = fence[1][0]
        fenceLength = fence[1].length
      } else if (fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
        fenceChar = ''
        fenceLength = 0
      }
      continue
    }
    if (fenceChar) continue
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      current = normalizeHeadingLabel(heading[1])
      if (!sections.has(current)) sections.set(current, false)
      continue
    }
    if (current && ANY_MARKDOWN_IMAGE_RE.test(line)) sections.set(current, true)
  }
  return sections
}

// Keeps `## 图片来源` honest after a removal: an entry whose section no longer
// holds an inline image would otherwise credit a source for an invisible image.
export function pruneImageSourcesSection(contentMd) {
  const text = String(contentMd || '')
  const lines = text.split('\n')
  const startIndex = lines.findIndex((line) => IMAGE_SOURCES_HEADING_RE.test(line.trim()))
  if (startIndex < 0) return text

  let endIndex = lines.length
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (NEXT_H2_RE.test(lines[index].trim())) {
      endIndex = index
      break
    }
  }

  const sections = collectHeadingImageState(text)
  const kept = []
  let dropped = 0
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const line = lines[index]
    const entry = IMAGE_SOURCE_ENTRY_RE.exec(line)
    if (!entry) {
      kept.push(line)
      continue
    }
    const label = normalizeHeadingLabel(entry[1])
    // Unknown labels stay: only drop entries we can positively tie to a section
    // that lost its image.
    if (sections.has(label) && sections.get(label) === false) {
      dropped += 1
      continue
    }
    kept.push(line)
  }
  if (dropped === 0) return text

  let body = kept.join('\n').replace(/\n{3,}/g, '\n\n')
  if (!/^\s*[-*+]\s+\S/m.test(body)) body = '\n- 无正文插图\n'
  return [...lines.slice(0, startIndex + 1), ...body.split('\n'), ...lines.slice(endIndex)].join('\n')
}

export function extractExternalMarkdownImages(contentMd, { trustedHosts = resolveTrustedImageHosts() } = {}) {
  const images = []
  const seen = new Set()
  transformMarkdownProse(contentMd, (chunk) => {
    for (const match of chunk.matchAll(MARKDOWN_IMAGE_RE)) {
      const url = String(match[2] || '').trim()
      try {
        if (trustedHosts.has(new URL(url).hostname.toLowerCase()) || seen.has(url)) continue
      } catch {
        continue
      }
      seen.add(url)
      images.push({ alt: String(match[1] || ''), url })
    }
    return chunk
  })
  return images
}

export function rewriteExternalMarkdownImages(contentMd, outcomes, { trustedHosts = resolveTrustedImageHosts() } = {}) {
  const original = String(contentMd || '')
  let localized = 0
  let removed = 0

  const isTrusted = (url) => {
    try {
      return trustedHosts.has(new URL(url).hostname.toLowerCase())
    } catch {
      return null
    }
  }

  const rewritten = transformMarkdownProse(original, (chunk) => chunk
    .replace(LINKED_MARKDOWN_IMAGE_RE, (markdown, alt, rawUrl, href) => {
      const url = String(rawUrl || '').trim()
      const trusted = isTrusted(url)
      if (trusted === null) {
        removed += 1
        return REMOVED_IMAGE_TOKEN
      }
      if (trusted) return markdown
      const outcome = outcomes.get(url)
      if (!outcome) return markdown
      if (outcome.status === 'localized' && outcome.url) {
        localized += 1
        return `[![${alt}](${outcome.url})](${href})`
      }
      if (outcome.status === 'remove') {
        removed += 1
        return REMOVED_IMAGE_TOKEN
      }
      return markdown
    })
    .replace(MARKDOWN_IMAGE_RE, (markdown, alt, rawUrl) => {
      const url = String(rawUrl || '').trim()
      const trusted = isTrusted(url)
      if (trusted === null) {
        removed += 1
        return REMOVED_IMAGE_TOKEN
      }
      if (trusted) return markdown
      const outcome = outcomes.get(url)
      if (!outcome) return markdown
      if (outcome.status === 'localized' && outcome.url) {
        localized += 1
        return `![${alt}](${outcome.url})`
      }
      if (outcome.status === 'remove') {
        removed += 1
        return REMOVED_IMAGE_TOKEN
      }
      return markdown
    }))

  let content = collapseRemovalGaps(rewritten)
  if (removed > 0) content = pruneImageSourcesSection(content)
  return { content, localized, removed, changed: content !== original }
}

// --- Download failure classification --------------------------------------------

const DEFAULT_DOWNLOAD_ATTEMPTS = 3
const DEFAULT_RETRY_BASE_DELAY_MS = 500
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

function httpStatusFromError(error) {
  const direct = Number(error?.status)
  if (Number.isFinite(direct) && direct > 0) return direct
  const match = /HTTP\s+(\d{3})/i.exec(String(error?.message || ''))
  return match ? Number(match[1]) : 0
}

// Only proof that the resource is gone (404/410) or that the bytes are provably
// not an image may delete a published image. Throttling, hotlink protection,
// 5xx, DNS flaps and timeouts keep the article untouched — the same posture the
// upload stage already had.
export function classifyDownloadFailure(error) {
  if (error?.permanentFailure === true) return 'permanent'
  const status = httpStatusFromError(error)
  if (status === 404 || status === 410) return 'permanent'
  return 'transient'
}

async function downloadImageWithRetry(url, downloadImage, {
  attempts = DEFAULT_DOWNLOAD_ATTEMPTS,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  sleepImpl = sleep,
  logger = console,
} = {}) {
  const maxAttempts = Math.max(1, Math.floor(Number(attempts) || 1))
  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await downloadImage(url)
    } catch (error) {
      lastError = error
      if (classifyDownloadFailure(error) === 'permanent' || attempt >= maxAttempts) break
      const delay = baseDelayMs * (2 ** (attempt - 1))
      logger?.warn?.(`Image download attempt ${attempt}/${maxAttempts} failed (${url}): ${error?.message || 'unknown error'}; retrying in ${delay}ms`)
      await sleepImpl(delay)
    }
  }
  throw lastError || new Error('Image download failed')
}

export async function repairPublishedPostImages({
  token,
  apply = false,
  concurrency = 3,
  pageSize = 50,
  maxPages = DEFAULT_MAX_LIST_PAGES,
  fetchImpl = fetch,
  downloadImage = downloadVerifiedImage,
  uploadImage = uploadLocalizedImage,
  downloadAttempts = DEFAULT_DOWNLOAD_ATTEMPTS,
  retryBaseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  sleepImpl = sleep,
  logger = console,
} = {}) {
  if (!token) throw new Error('Admin token is required for batch repair')
  const trustedHosts = resolveTrustedImageHosts()
  warnIfImageCdnUnconfigured(trustedHosts, logger)
  const summaries = await fetchPublishedAdminPosts(token, { pageSize, maxPages, fetchImpl, logger })
  const postResults = await mapWithConcurrency(summaries, concurrency, async (summary) => {
    try {
      const post = await fetchAdminPostWith(summary.id, token, fetchImpl)
      return { post, error: null }
    } catch (error) {
      return { post: summary, error: error?.message || 'post fetch failed' }
    }
  })

  const uniqueUrls = new Set()
  for (const result of postResults) {
    if (!result.error) {
      for (const image of extractExternalMarkdownImages(result.post.content_md, { trustedHosts })) {
        uniqueUrls.add(image.url)
      }
    }
  }

  const outcomeEntries = await mapWithConcurrency([...uniqueUrls], concurrency, async (url) => {
    let image
    try {
      image = await downloadImageWithRetry(url, downloadImage, {
        attempts: downloadAttempts,
        baseDelayMs: retryBaseDelayMs,
        sleepImpl,
        logger,
      })
    } catch (error) {
      const reason = error?.message || 'image verification failed'
      if (classifyDownloadFailure(error) === 'permanent') {
        return [url, { status: 'remove', stage: 'download', reason }]
      }
      // Transient upstream trouble must never delete a published image.
      return [url, { status: 'download_failed', stage: 'download', reason }]
    }
    if (!apply) {
      return [url, { status: 'verified', content_type: image.contentType, bytes: image.buffer.length }]
    }
    try {
      const localizedUrl = await uploadImage({ image, token, blogApiBase: BLOG_API_BASE, fetchImpl })
      return [url, { status: 'localized', url: localizedUrl }]
    } catch (error) {
      // A transient storage failure must not turn a valid published image into a deletion.
      return [url, { status: 'upload_failed', stage: 'upload', reason: error?.message || 'image upload failed' }]
    }
  })
  const outcomes = new Map(outcomeEntries)

  const audit = {
    mode: apply ? 'apply' : 'dry-run',
    trusted_image_hosts: [...trustedHosts].sort(),
    posts_scanned: summaries.length,
    posts_with_external_images: 0,
    posts_changed: 0,
    posts_would_change: 0,
    posts_failed: postResults.filter((item) => item.error).length,
    image_references: 0,
    unique_external_urls: uniqueUrls.size,
    unique_verified: [...outcomes.values()].filter((item) => item.status === 'verified').length,
    unique_localized: [...outcomes.values()].filter((item) => item.status === 'localized').length,
    unique_removed: [...outcomes.values()].filter((item) => item.status === 'remove').length,
    unique_download_failed: [...outcomes.values()].filter((item) => item.status === 'download_failed').length,
    unique_upload_failed: [...outcomes.values()].filter((item) => item.status === 'upload_failed').length,
    failures: postResults
      .filter((item) => item.error)
      .map((item) => ({ post_id: item.post?.id, slug: item.post?.slug, stage: 'fetch', error: item.error })),
  }

  const actionableStatuses = new Set(['verified', 'localized', 'remove'])
  const updates = []
  for (const result of postResults) {
    if (result.error) continue
    const images = extractExternalMarkdownImages(result.post.content_md, { trustedHosts })
    if (images.length === 0) continue
    audit.posts_with_external_images += 1
    audit.image_references += images.length
    if (!apply) {
      // Only images that would actually be rewritten count. Posts whose images
      // all ended in download_failed are left alone on apply.
      const actionable = images.some((image) => actionableStatuses.has(outcomes.get(image.url)?.status))
      if (actionable) audit.posts_would_change += 1
      continue
    }
    const rewritten = rewriteExternalMarkdownImages(result.post.content_md, outcomes, { trustedHosts })
    if (rewritten.changed) updates.push({ post: result.post, rewritten })
  }

  if (apply) {
    const updateResults = await mapWithConcurrency(updates, concurrency, async ({ post, rewritten }) => {
      try {
        await updatePostContentWith(token, post.id, rewritten.content, fetchImpl)
        return { ok: true, post }
      } catch (error) {
        return { ok: false, post, error: error?.message || 'post update failed' }
      }
    })
    audit.posts_changed = updateResults.filter((item) => item.ok).length
    for (const result of updateResults.filter((item) => !item.ok)) {
      audit.posts_failed += 1
      audit.failures.push({ post_id: result.post.id, slug: result.post.slug, stage: 'update', error: result.error })
    }
  }

  audit.removed_urls = [...outcomes.entries()]
    .filter(([, outcome]) => outcome.status === 'remove')
    .map(([url, outcome]) => ({ url: auditSafeUrl(url), reason: outcome.reason }))
  audit.image_failures = [...outcomes.entries()]
    .filter(([, outcome]) => outcome.status === 'upload_failed' || outcome.status === 'download_failed')
    .map(([url, outcome]) => ({ url: auditSafeUrl(url), stage: outcome.stage, error: outcome.reason }))
  logger?.log?.(JSON.stringify(audit, null, 2))
  return audit
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

/**
 * Builds the picker's `sectionAttribution` map from an already-published body.
 *
 * This tool exists to repair posts whose illustrations do not match their text, so it needs
 * the same two relevance signals the live pipeline now gets — and both are recoverable from
 * the published markdown alone:
 *
 *   - which sources a section cites: `finalizeArticle` links the `[S1]` markers, so the body
 *     carries `[S1](https://…)`. The URL is used directly rather than the number, because the
 *     mapping from `S1` to the Nth entry of 参考来源 is an assumption and the URL is a fact.
 *   - what the section is about: its own prose, which is the only text that can be compared
 *     against a candidate image's caption.
 *
 * Without this, repair ranked images for a Chinese heading by substring-matching it against
 * English image URLs, which never matched anything — the defect this whole change is about.
 */
export function buildAttributionFromPublishedBody(contentMd, headings) {
  const lines = String(contentMd || '').split(/\r?\n/)
  const attribution = {}
  for (const heading of headings) {
    // `extractImageTargetSections` yields bare headings while the pipeline's own section
    // lists keep the `## ` marker. Both are accepted so the two callers cannot drift.
    const bare = String(heading).replace(/^#{1,6}\s*/, '').trim()
    const startIndex = lines.findIndex((line) => line.match(/^##\s+(.*)$/)?.[1]?.trim() === bare)
    if (startIndex < 0) continue
    let endIndex = lines.length
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (NEXT_H2_RE.test(lines[index].trim())) {
        endIndex = index
        break
      }
    }
    const body = lines.slice(startIndex + 1, endIndex).join('\n')
    const sourceUrls = []
    for (const match of body.matchAll(/\[S\d+\]\((https?:\/\/[^)\s]+)\)/g)) {
      if (!sourceUrls.includes(match[1])) sourceUrls.push(match[1])
    }
    attribution[heading] = {
      heading,
      source_ids: [],
      source_urls: sourceUrls,
      text: body
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~|-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1200),
      origin: sourceUrls.length > 0 ? 'body_citation' : 'none',
    }
  }
  return attribution
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

export function stripThirdPartyMarkdownImages(contentMd, { trustedHosts = resolveTrustedImageHosts() } = {}) {
  const original = String(contentMd || '')
  let removed = 0

  const tokenized = transformMarkdownProse(original, (chunk) => chunk.replace(
    /^[^\S\n]*!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)[^\S\n]*$/gim,
    (line, imageUrl) => {
      try {
        if (trustedHosts.has(new URL(imageUrl).hostname.toLowerCase())) return line
      } catch {
        // Invalid absolute image URLs are unsafe to preserve.
      }
      removed += 1
      return REMOVED_IMAGE_TOKEN
    },
  ), { skipInlineCode: false })

  return { content: collapseRemovalGaps(tokenized), removed }
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
  const payload = await resp.json()
  const jobId = Number(payload?.job_id || payload?.id)
  if (!Number.isFinite(jobId) || jobId <= 0) return payload
  // Reuse the shared poller so this script cannot drift from the pipeline's
  // job timeout again.
  return waitForImageGenerationJob({
    blogApiBase: BLOG_API_BASE,
    token,
    jobId,
    initialJob: payload,
  })
}

async function updatePostContentWith(token, postId, contentMd, fetchImpl = fetch) {
  const resp = await fetchImpl(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    // Media repair edits years-old posts. Without this the backend re-runs
    // notification dispatch and mails the whole subscriber list about archives.
    body: JSON.stringify({ content_md: contentMd, suppress_notifications: true }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    throw new Error(`Update post content failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}


async function updatePostContent(token, postId, contentMd) {
  return updatePostContentWith(token, postId, contentMd, fetch)
}

async function main() {
  const options = parseArgs()
  if (options.all) {
    const token = await adminLogin()
    await repairPublishedPostImages({
      token,
      apply: options.apply,
      concurrency: options.concurrency,
      pageSize: options.pageSize,
    })
    return
  }
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

  const trustedHosts = resolveTrustedImageHosts()
  warnIfImageCdnUnconfigured(trustedHosts, console)

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
  // This tool is how the existing duplicate-illustration backlog gets repaired, and it is run
  // once per post. Without the same published-image memory the pipeline uses, repairing 25
  // posts one at a time would simply re-pick the same picture for several of them.
  // Window end is today rather than the post's own coverage_date: the duplicate a reader
  // notices is one shared with what is currently on the site. An unparseable date would make
  // shiftCoverageDate return '' and silently match nothing, so it is never taken from the post.
  const usedImages = await resolveUsedImageRegistry(
    { imageDedupe: resolveImageDedupeConfig(config), force: false, dryRun: false },
    { coverageDate: new Date().toISOString().slice(0, 10) },
  )
  // The post being repaired is part of that history; keeping its own current illustrations in
  // the memory would forbid the picker from ever re-selecting an image that is fine as it is.
  for (const url of extractInlineImageUrlsFromMarkdown(post.content_md)) {
    const key = normalizeImageUrlForDedupe(url)
    if (key) usedImages.keys.delete(key)
  }
  const pickedImagePlans = dedupeImagePlansAgainstUsed(await pickSourceImages({
    sections,
    topic: post.topic_key || post.title,
    sourceItems: sources.filter((source) => allowedTypes.size === 0 || allowedTypes.has(source.source_type)),
    // Same relevance contract the live pipeline uses. Recovered from the published body,
    // which is all this tool has: without it a Chinese heading is matched against English
    // image URLs and scores zero every time, so ranking falls back to "whatever the page
    // listed first" — exactly how the mismatched illustrations got there.
    sectionAttribution: buildAttributionFromPublishedBody(post.content_md, sections),
    config,
    isImageUrlExcluded: usedImages.has,
    normalizeUrlForDedupe: normalizeImageUrlForDedupe,
  }), usedImages)
  const imagePlans = await localizeImagePlans(pickedImagePlans, {
    token,
    blogApiBase: BLOG_API_BASE,
  })
  const cleaned = stripThirdPartyMarkdownImages(post.content_md, { trustedHosts })

  if (imagePlans.length === 0 && cleaned.removed === 0) {
    console.log('No qualified inline images were found. Post body remains unchanged.')
    return
  }

  const contentWithImages = insertImagesIntoContent(cleaned.content, imagePlans)
  const nextContent = replaceOrAppendImageSourcesSection(contentWithImages, imagePlans)
  if (nextContent === post.content_md) {
    console.log('Inline image content is already up to date.')
    return
  }

  await updatePostContent(token, post.id, nextContent)
  console.log(`Updated post content with ${imagePlans.length} localized inline image(s); removed ${cleaned.removed} third-party image(s).`)
}

// resolve() vs fileURLToPath() compared Windows paths whose drive letters differ
// in case ("c:\…" vs "C:\…"), so the script exited 0 without doing anything.
const isMainModule = process.argv[1]
  ? pathToFileURL(process.argv[1]).href === import.meta.url
  : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
