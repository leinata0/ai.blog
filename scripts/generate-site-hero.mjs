#!/usr/bin/env node

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const XAI_API_KEY = process.env.XAI_API_KEY || ''
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

async function downloadAndUploadImage(imageUrl, token) {
  const imageResponse = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodexSiteHeroBot/1.0)' },
    signal: AbortSignal.timeout(30000),
  })

  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image: ${imageResponse.status}`)
  }

  const contentType = imageResponse.headers.get('content-type') || 'image/png'
  const extension = contentType.includes('png')
    ? '.png'
    : contentType.includes('webp')
      ? '.webp'
      : '.jpg'

  const buffer = Buffer.from(await imageResponse.arrayBuffer())
  const filename = `site-hero-${Date.now()}${extension}`
  const boundary = `----FormBoundary${Date.now()}`
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
  const footer = `\r\n--${boundary}--\r\n`
  const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from(footer)])

  const uploadResponse = await fetch(`${BLOG_API_BASE}/api/admin/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
    signal: AbortSignal.timeout(30000),
  })

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status} ${(await uploadResponse.text()).slice(0, 300)}`)
  }

  const payload = await uploadResponse.json()
  return payload.url?.startsWith('http') ? payload.url : `${BLOG_API_BASE}${payload.url}`
}

async function generateHeroWithGrok(prompt, token) {
  if (!XAI_API_KEY) {
    throw new Error('Missing XAI_API_KEY')
  }

  const response = await fetch('https://api.x.ai/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-imagine-image',
      prompt,
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    throw new Error(`Grok generation failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }

  const grokUrl = (await response.json()).data?.[0]?.url
  if (!grokUrl) {
    throw new Error('Grok returned no image URL')
  }

  return downloadAndUploadImage(grokUrl, token)
}

async function updateHeroImage(settings, heroImage, token) {
  const response = await fetch(`${BLOG_API_BASE}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      author_name: settings.author_name || '',
      bio: settings.bio || '',
      avatar_url: settings.avatar_url || '',
      hero_image: heroImage,
      github_link: settings.github_link || '',
      announcement: settings.announcement || '',
      site_url: settings.site_url || '',
      friend_links: settings.friend_links || '[]',
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`Update settings failed: ${response.status} ${(await response.text()).slice(0, 300)}`)
  }

  return response.json()
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

  const heroImage = await generateHeroWithGrok(prompt, token)
  console.log(`Hero image uploaded: ${heroImage}`)

  const updated = await updateHeroImage(settings, heroImage, token)
  console.log(`Hero image updated: ${updated.hero_image}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
