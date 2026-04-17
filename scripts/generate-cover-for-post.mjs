#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'

const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const XAI_API_KEY = process.env.XAI_API_KEY || ''
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || ''
const SILICONFLOW_BASE_URL = (process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1').replace(/\/$/, '')
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL || 'deepseek-ai/DeepSeek-V3'
const POST_ID = Number(process.env.POST_ID || 0)
const MANUAL_COVER_PROMPT = String(process.env.COVER_PROMPT || '').trim()
const OVERWRITE_EXISTING_COVER = String(process.env.OVERWRITE_EXISTING_COVER || 'false').toLowerCase() === 'true'

export function extractHeadings(contentMd, limit = 6) {
  const matches = String(contentMd || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^##+\s+(.*)$/)?.[1]?.trim() || '')
    .filter(Boolean)
  return matches.slice(0, limit)
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[>*_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildPromptContext(post) {
  const headings = extractHeadings(post?.content_md || '')
  const summary = stripMarkdown(post?.summary || '').slice(0, 240)
  const bodyPreview = stripMarkdown(post?.content_md || '').slice(0, 600)
  return {
    title: String(post?.title || '').trim(),
    summary,
    headings,
    tags: Array.isArray(post?.tags) ? post.tags.map((tag) => typeof tag === 'string' ? tag : tag?.name || tag?.slug || '').filter(Boolean) : [],
    contentType: String(post?.content_type || 'post').trim(),
    bodyPreview,
  }
}

export function sanitizeCoverPrompt(prompt) {
  return String(prompt || '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^wide landscape banner[^:]*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildHeuristicCoverPrompt(post) {
  const context = buildPromptContext(post)
  const headingPart = context.headings.length > 0
    ? `Key angles: ${context.headings.slice(0, 3).join('; ')}.`
    : ''
  const tagPart = context.tags.length > 0
    ? `Visual hints: ${context.tags.slice(0, 4).join(', ')}.`
    : ''
  return sanitizeCoverPrompt(
    `Editorial hero illustration for a Chinese tech blog article about ${context.title}. `
    + `${context.summary} ${headingPart} ${tagPart} `
    + 'Professional, modern, cinematic, no text overlay, no watermark, strong focal subject, suitable for a wide website banner.'
  )
}

async function login() {
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

async function fetchAdminPost(postId, token) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`Fetch post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function generatePromptWithSiliconFlow(post) {
  if (!SILICONFLOW_API_KEY) return ''
  const context = buildPromptContext(post)
  const system = [
    'You write one English hero-image prompt for an AI/tech blog article.',
    'Return only the prompt text, no markdown, no quotes, no JSON.',
    'Keep it under 55 words.',
    'Focus on a single strong visual scene, not a collage.',
    'No text overlay, no logos, no watermark, no UI mockup unless the article is specifically about product interface design.',
    'Suitable for a wide website cover banner.',
  ].join(' ')
  const user = [
    `Title: ${context.title}`,
    `Summary: ${context.summary}`,
    `Headings: ${context.headings.join(' | ')}`,
    `Tags: ${context.tags.join(', ')}`,
    `Body preview: ${context.bodyPreview}`,
    'Generate one polished English image prompt that captures the article topic and tone.',
  ].join('\n')

  const resp = await fetch(`${SILICONFLOW_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SILICONFLOW_MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    console.warn(`SiliconFlow prompt generation failed: ${resp.status}`)
    return ''
  }

  const data = await resp.json()
  const text = data?.choices?.[0]?.message?.content || ''
  return sanitizeCoverPrompt(text)
}

async function buildAutoCoverPrompt(post) {
  const aiPrompt = await generatePromptWithSiliconFlow(post)
  if (aiPrompt) return aiPrompt
  return buildHeuristicCoverPrompt(post)
}

async function downloadAndUploadImage(imageUrl, token) {
  const imageResp = await fetch(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodexCoverBot/1.0)' },
    signal: AbortSignal.timeout(30000),
  })
  if (!imageResp.ok) {
    throw new Error(`Failed to download generated image: ${imageResp.status}`)
  }

  const contentType = imageResp.headers.get('content-type') || 'image/png'
  const ext = contentType.includes('png')
    ? '.png'
    : contentType.includes('webp')
      ? '.webp'
      : '.jpg'
  const buffer = Buffer.from(await imageResp.arrayBuffer())
  const filename = `manual-cover-${Date.now()}${ext}`
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

  if (!uploadResp.ok) {
    throw new Error(`Upload failed: ${uploadResp.status} ${(await uploadResp.text()).slice(0, 300)}`)
  }

  const uploadData = await uploadResp.json()
  return uploadData.url?.startsWith('http') ? uploadData.url : `${BLOG_API_BASE}${uploadData.url}`
}

async function generateCoverWithGrok(prompt, token) {
  if (!XAI_API_KEY) {
    throw new Error('Missing XAI_API_KEY')
  }

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

  if (!resp.ok) {
    throw new Error(`Grok generation failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  const grokUrl = (await resp.json()).data?.[0]?.url
  if (!grokUrl) {
    throw new Error('Grok returned no image URL')
  }

  return downloadAndUploadImage(grokUrl, token)
}

async function updatePostCover(postId, coverImage, token) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${postId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ cover_image: coverImage }),
    signal: AbortSignal.timeout(30000),
  })
  if (!resp.ok) {
    throw new Error(`Update failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function main() {
  if (!Number.isFinite(POST_ID) || POST_ID <= 0) {
    throw new Error('Missing or invalid POST_ID')
  }

  const token = await login()
  console.log('Admin login OK')

  const post = await fetchAdminPost(POST_ID, token)
  console.log(`Loaded post: ${post.title}`)

  if (post.cover_image && !OVERWRITE_EXISTING_COVER) {
    console.log('Post already has a cover image, skipping because overwrite is disabled.')
    return
  }

  const coverPrompt = MANUAL_COVER_PROMPT || await buildAutoCoverPrompt(post)
  if (!coverPrompt) {
    throw new Error('Failed to build cover prompt')
  }
  console.log(`Using cover prompt: ${coverPrompt}`)

  const coverImage = await generateCoverWithGrok(coverPrompt, token)
  console.log(`Cover uploaded: ${coverImage}`)

  const updated = await updatePostCover(POST_ID, coverImage, token)
  console.log(`Cover updated for post ${updated.id}: ${updated.slug}`)
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
