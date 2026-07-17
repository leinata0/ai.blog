#!/usr/bin/env node

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { buildPostCoverPrompt, presetFramingHint } from './lib/cover-art.mjs'

const ARTICLE_FILE = process.env.ARTICLE_FILE || './content/blog-migration-neon-r2.mjs'
const BLOG_API_BASE = resolveBlogApiBase()
const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const XAI_API_KEY = process.env.XAI_API_KEY || ''
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || ''

async function loadArticle() {
  const articleUrl = new URL(ARTICLE_FILE, import.meta.url)
  const mod = await import(articleUrl)
  return mod.default || mod.article || mod
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

export async function fetchExistingPostBySlug(
  slug,
  token,
  { blogApiBase = BLOG_API_BASE, fetchImpl = fetch, pageSize = 100 } = {},
) {
  for (let page = 1; ; page += 1) {
    const listResp = await fetchImpl(`${blogApiBase}/api/admin/posts?page=${page}&page_size=${pageSize}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!listResp.ok) {
      throw new Error(`Failed to load admin posts: ${listResp.status} ${(await listResp.text()).slice(0, 300)}`)
    }

    const data = await listResp.json()
    const items = Array.isArray(data.items) ? data.items : []
    const existingPost = items.find((item) => item.slug === slug)
    if (existingPost) return existingPost

    const total = Number(data.total)
    const reachedKnownEnd = Number.isFinite(total) && page * pageSize >= total
    if (reachedKnownEnd || items.length < pageSize) return null
  }
}

async function downloadAndUploadImage(imageUrl, token, fetchImpl = fetch) {
  const imageResp = await fetchImpl(imageUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CodexPublisher/1.0)' },
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

  const uploadResp = await fetchImpl(`${BLOG_API_BASE}/api/admin/upload`, {
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
  return uploadData.url
}

async function generateCoverWithProvider(prompt, token, provider, fetchImpl = fetch) {
  const resp = await fetchImpl(provider.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      prompt,
      n: 1,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) {
    throw new Error(`${provider.name} generation failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  const imageUrl = (await resp.json()).data?.[0]?.url
  if (!imageUrl) {
    throw new Error(`${provider.name} returned no image URL`)
  }

  return downloadAndUploadImage(imageUrl, token, fetchImpl)
}

export async function generateCoverWithFallback(
  prompt,
  token,
  {
    providers = [
      {
        name: 'Grok',
        endpoint: 'https://api.x.ai/v1/images/generations',
        model: 'grok-imagine-image',
        apiKey: XAI_API_KEY,
      },
      {
        name: 'SiliconFlow',
        endpoint: 'https://api.siliconflow.cn/v1/images/generations',
        model: 'black-forest-labs/FLUX.1-schnell',
        apiKey: SILICONFLOW_API_KEY,
      },
    ],
    generate = generateCoverWithProvider,
    logger = console,
    preset = 'post_cover',
  } = {},
) {
  if (!prompt) return ''

  const framedPrompt = `${presetFramingHint(preset)}: ${prompt}`
  for (const provider of providers) {
    if (!provider.apiKey) continue
    try {
      return await generate(framedPrompt, token, provider)
    } catch (error) {
      logger.warn(`${error.message}; trying the next cover provider`)
    }
  }
  return ''
}

export function resolveExistingCover(article, existingPost) {
  return String(article.cover_image || existingPost?.cover_image || '').trim()
}

function normalizeArticle(article, coverImage) {
  return {
    title: String(article.title || '').trim(),
    slug: String(article.slug || '').trim(),
    summary: String(article.summary || '').trim(),
    content_md: String(article.content_md || '').trim(),
    tags: Array.isArray(article.tags) ? article.tags : [],
    cover_image: coverImage || String(article.cover_image || '').trim(),
    is_published: article.is_published !== false,
    is_pinned: article.is_pinned === true,
  }
}

async function createOrUpdatePost(post, existingPost, token) {
  const url = existingPost
    ? `${BLOG_API_BASE}/api/admin/posts/${existingPost.id}`
    : `${BLOG_API_BASE}/api/admin/posts`
  const method = existingPost ? 'PUT' : 'POST'

  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(post),
    signal: AbortSignal.timeout(30000),
  })

  if (!resp.ok) {
    throw new Error(`${method} post failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  return resp.json()
}

async function main() {
  const article = await loadArticle()
  if (!article.title || !article.slug || !article.content_md) {
    throw new Error('Article file is missing required fields')
  }

  console.log(`Loaded article: ${article.title}`)
  const token = await login()
  console.log('Admin login OK')

  const existingPost = await fetchExistingPostBySlug(article.slug, token)
  if (existingPost) {
    console.log(`Existing post found: id=${existingPost.id}`)
  } else {
    console.log('No existing post with the same slug, creating a new one')
  }

  let coverImage = resolveExistingCover(article, existingPost)
  const normalizedCoverPrompt = buildPostCoverPrompt(article, {
    manualPrompt: String(article.cover_prompt || '').trim(),
  })
  if (!coverImage && normalizedCoverPrompt) {
    console.log('Generating cover image...')
    coverImage = await generateCoverWithFallback(normalizedCoverPrompt, token, { preset: 'post_cover' })
    if (coverImage) {
      console.log(`Cover generated: ${coverImage}`)
    } else {
      console.warn('All configured cover providers failed or were unavailable; publishing without a generated cover')
    }
  }

  const payload = normalizeArticle(article, coverImage)
  const result = await createOrUpdatePost(payload, existingPost, token)

  console.log(`Post published successfully: id=${result.id} slug=${result.slug}`)
  console.log(`${BLOG_API_BASE}/api/posts/${result.slug}`)
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
