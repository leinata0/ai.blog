#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import {
  generateSeriesCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()

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

function buildSeriesCoverPrompt(series) {
  return [
    'Editorial hero image for an AI blog series.',
    `Series: ${series?.title || series?.slug || 'AI series'}.`,
    series?.description ? `Description: ${series.description}.` : '',
    'No text overlay, no watermark, wide cinematic banner.',
  ].filter(Boolean).join(' ')
}

async function generateSeriesCover(series, token, overwrite) {
  const prompt = buildSeriesCoverPrompt(series)
  const job = await generateSeriesCoverViaAdminJob({
    blogApiBase: BLOG_API_BASE,
    token,
    targetId: series?.id,
    prompt,
    overwrite,
  })
  if (!imageGenerationJobSucceeded(job)) {
    throw new Error(job.error || `Configured image channel failed: ${job.error_code || job.status || 'unknown_error'}`)
  }
  return imageGenerationJobImageUrl(job)
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
      const generatedCover = await generateSeriesCover(series, token, args.force)
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
