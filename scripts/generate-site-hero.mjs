#!/usr/bin/env node

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import {
  generateSiteHeroViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from './lib/admin-image-generation.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const HERO_PROMPT = String(process.env.HERO_PROMPT || '').trim()
const OVERWRITE_EXISTING_HERO = String(process.env.OVERWRITE_EXISTING_HERO || 'false').toLowerCase() === 'true'
const DRY_RUN = String(process.env.DRY_RUN || 'false').toLowerCase() === 'true'

function buildDefaultHeroPrompt() {
  return [
    'Vertical 4:5 editorial poster for a Chinese AI news and analysis website.',
    'Blue and white signal-wall aesthetic, luminous newsroom screens, layered information ribbons, subtle grid, refined magazine composition, calm futuristic atmosphere.',
    'No text overlay, no logos, no watermark, no UI mockup, premium lighting, clean focal composition.',
  ].join(' ')
}

async function login() {
  if (!ADMIN_PASSWORD) {
    throw new Error('Missing ADMIN_PASSWORD')
  }

  const response = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Admin login failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }

  return (await response.json()).access_token
}

async function fetchSettings(token) {
  const response = await fetch(`${BLOG_API_BASE}/api/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    throw new Error(`Fetch settings failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }

  return response.json()
}

async function generateHero(prompt, token) {
  const job = await generateSiteHeroViaAdminJob({
    blogApiBase: BLOG_API_BASE,
    token,
    prompt,
    overwrite: OVERWRITE_EXISTING_HERO,
  })
  if (!imageGenerationJobSucceeded(job)) {
    throw new Error(job.error || `Configured image channel failed: ${job.error_code || job.status || 'unknown_error'}`)
  }
  return imageGenerationJobImageUrl(job)
}

async function main() {
  const prompt = HERO_PROMPT || buildDefaultHeroPrompt()
  console.log(`Using hero prompt: ${prompt}`)

  if (DRY_RUN) {
    console.log('Dry run complete.')
    return
  }

  const token = await login()
  console.log('Admin login OK')

  const settings = await fetchSettings(token)
  if (settings.hero_image && !OVERWRITE_EXISTING_HERO) {
    console.log('Hero image already exists, skipping because overwrite is disabled.')
    return
  }

  const heroImage = await generateHero(prompt, token)
  console.log(`Hero image updated through configured image channel: ${heroImage}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
