#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const XAI_API_KEY = process.env.XAI_API_KEY?.trim() || ''

export function parseSeriesCoverArgs(argv = process.argv.slice(2)) {
  const options = {
    dryRun: false,
    force: false,
    limit: 50,
    offset: 0,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--force') options.force = true
    else if (current === '--limit' && argv[index + 1]) options.limit = Number(argv[++index])
    else if (current.startsWith('--limit=')) options.limit = Number(current.split('=')[1])
    else if (current === '--offset' && argv[index + 1]) options.offset = Number(argv[++index])
    else if (current.startsWith('--offset=')) options.offset = Number(current.split('=')[1])
  }
  options.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(options.limit, 200) : 50
  options.offset = Number.isFinite(options.offset) && options.offset >= 0 ? options.offset : 0
  return options
}

async function login() {
  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  })
  if (!resp.ok) throw new Error(`Admin login failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  return (await resp.json()).access_token
}

async function fetchSeriesList(token) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/series`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) throw new Error(`Fetch series failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  const data = await resp.json()
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return Array.isArray(data?.series) ? data.series : []
}

async function downloadAndUploadImage(imageUrl, token) {
  const imageResp = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SeriesCoverBot/1.0)' },
    signal: AbortSignal.timeout(30000),
  })
  if (!imageResp.ok) throw new Error(`Failed to download generated image: ${imageResp.status}`)
  const contentType = imageResp.headers.get('content-type') || 'image/png'
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg'
  const buffer = Buffer.from(await imageResp.arrayBuffer())
  const filename = `series-cover-${Date.now()}${ext}`
  const boundary = `----FormBoundary${Date.now()}`
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  const footer = `\r\n--${boundary}--\r\n`
  const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)])

  const uploadResp = await fetch(`${BLOG_API_BASE}/api/admin/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(30000),
  })
  if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status} ${(await uploadResp.text()).slice(0, 300)}`)
  const data = await uploadResp.json()
  return data.url?.startsWith('http') ? data.url : `${BLOG_API_BASE}${data.url}`
}

function buildSeriesCoverPrompt(series) {
  return [
    'Editorial hero image for an AI blog series.',
    `Series: ${series?.title || series?.slug || 'AI series'}.`,
    series?.description ? `Description: ${series.description}.` : '',
    'No text overlay, no watermark, wide cinematic banner.',
  ].filter(Boolean).join(' ')
}

async function generateSeriesCover(series, token) {
  if (!XAI_API_KEY) throw new Error('Missing XAI_API_KEY')
  const prompt = buildSeriesCoverPrompt(series)
  const resp = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-imagine-image',
      prompt: `Wide landscape banner image, cinematic, high quality: ${prompt}`,
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  })
  if (!resp.ok) throw new Error(`Grok generation failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  const grokUrl = (await resp.json()).data?.[0]?.url
  if (!grokUrl) throw new Error('Grok returned no image URL')
  return downloadAndUploadImage(grokUrl, token)
}

async function updateSeriesCover(series, coverImage, token) {
  const id = Number(series?.id)
  if (!Number.isFinite(id)) return { ok: false, reason: 'missing_series_id' }
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/series/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cover_image: coverImage }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    throw new Error(`Update series cover failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return { ok: true }
}

export async function runBackfillSeriesCovers(options = {}) {
  const args = {
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    limit: Number.isFinite(Number(options.limit)) ? Number(options.limit) : 50,
    offset: Number.isFinite(Number(options.offset)) ? Number(options.offset) : 0,
  }
  const token = await login()
  const seriesList = await fetchSeriesList(token)
  const targetList = seriesList.slice(args.offset, args.offset + args.limit)
  const items = []

  for (const series of targetList) {
    const hasCover = String(series?.cover_image || '').trim().length > 0
    if (!args.force && hasCover) {
      items.push({ series_id: series?.id || null, slug: series?.slug || '', status: 'skipped_existing' })
      continue
    }
    if (args.dryRun) {
      items.push({ series_id: series?.id || null, slug: series?.slug || '', status: 'dry_run' })
      continue
    }
    try {
      const generatedCover = await generateSeriesCover(series, token)
      await updateSeriesCover(series, generatedCover, token)
      items.push({ series_id: series?.id || null, slug: series?.slug || '', status: 'updated', cover_image: generatedCover })
    } catch (error) {
      items.push({ series_id: series?.id || null, slug: series?.slug || '', status: 'failed', reason: error.message })
    }
  }

  return {
    dry_run: args.dryRun,
    processed_count: items.length,
    updated_count: items.filter((item) => item.status === 'updated').length,
    skipped_count: items.filter((item) => item.status.startsWith('skipped')).length,
    failed_count: items.filter((item) => item.status === 'failed').length,
    items,
  }
}

async function main() {
  const report = await runBackfillSeriesCovers(parseSeriesCoverArgs())
  console.log(JSON.stringify(report, null, 2))
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.stack || error.message)
    process.exit(1)
  })
}
