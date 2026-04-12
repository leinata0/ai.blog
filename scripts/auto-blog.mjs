#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFeedXml, dedupeResearchItems, runBlogwatcher } from './lib/blogwatcher.mjs'
import { runArxiv } from './lib/arxiv.mjs'
import { getBlogFormatProfile, buildFormatPrompt } from './lib/blog-format.mjs'
import { evaluateQualityGate, formatQualityGateReport } from './lib/quality-gate.mjs'
import { pickSourceImages } from './lib/source-image-picker.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY?.trim()
const SILICONFLOW_BASE_URL = (
  process.env.SILICONFLOW_BASE_URL?.trim() || 'https://api.siliconflow.cn/v1'
).replace(/\/$/, '')
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL?.trim() || 'deepseek-ai/DeepSeek-V3'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BLOG_API_BASE = process.env.BLOG_API_BASE || 'https://api.563118077.xyz'
const XAI_API_KEY = process.env.XAI_API_KEY?.trim() || ''
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')

const DRY_RUN = process.argv.includes('--dry-run')

function trimText(value, max = 800) {
  const text = String(value || '').trim()
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function removeBoilerplate(text) {
  return String(text || '')
    .replace(/^(Skip to (?:content|main)|Navigation|Menu|Cookie|Accept all|Sign up|Subscribe|Newsletter|Advertisement|Related Articles?)[\s\S]{0,200}$/gim, '')
    .replace(/^(Copyright|All rights reserved|Privacy Policy|Terms of Service).*$/gim, '')
    .replace(/^\[?(Share|Tweet|Pin|Email|Print|Facebook|Twitter|LinkedIn)\]?.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function smartTruncate(text, maxLen = 26000) {
  const raw = String(text || '')
  if (raw.length <= maxLen) return raw
  const cut = raw.lastIndexOf('\n\n', maxLen)
  return cut > maxLen * 0.5 ? raw.slice(0, cut) : raw.slice(0, maxLen)
}

function normalizeKeywords(values) {
  return (Array.isArray(values) ? values : [values])
    .flatMap((value) => String(value || '').split(/[,\n]/))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6)
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  return JSON.parse(raw)
}

async function fetchBaseFeed(feed) {
  const resp = await fetch(feed.url, {
    headers: {
      'User-Agent': 'AutoBlogBot/3.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) return []
  const xml = await resp.text()
  return parseFeedXml(xml, {
    name: feed.tag,
    source_type: 'rss',
    lang: feed.lang,
    quality_weight: 0.45,
  })
}

async function fetchAllFeeds(config, maxItems = 30) {
  console.log(`Fetching ${config.rss_feeds.length} base feeds...`)
  const settled = await Promise.allSettled((config.rss_feeds || []).map((feed) => fetchBaseFeed(feed)))
  const items = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
  return dedupeResearchItems(items)
    .sort((left, right) => Date.parse(right.published_at || 0) - Date.parse(left.published_at || 0))
    .slice(0, maxItems)
}

async function jinaRead(url, maxLen = 5000) {
  try {
    const resp = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/markdown', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(20000),
    })
    if (!resp.ok) return ''
    const text = await resp.text()
    return text.slice(0, maxLen)
  } catch {
    return ''
  }
}

async function enrichWithFullText(items, concurrency = 5) {
  const queue = items.map((item) => ({ ...item }))
  let active = 0
  let index = 0

  return await new Promise((resolve) => {
    function pump() {
      if (index >= queue.length && active === 0) {
        resolve(queue)
        return
      }
      while (active < concurrency && index < queue.length) {
        const current = queue[index++]
        active += 1
        jinaRead(current.url, 6000)
          .then((text) => {
            if (text.length > 100) {
              current.full_text = removeBoilerplate(text)
              current.evidence_snippets = [trimText(current.full_text, 180)]
              current.score = Number((current.score + 0.08).toFixed(3))
            }
          })
          .finally(() => {
            active -= 1
            pump()
          })
      }
    }

    pump()
  })
}

async function collectBaseMaterials(config) {
  const feedItems = await fetchAllFeeds(config, 30)
  const itemsWithLinks = feedItems.filter((item) => item.url).slice(0, 15)
  const enriched = await enrichWithFullText(itemsWithLinks)

  let materials = dedupeResearchItems(enriched)
  const combinedText = materials.map((item) => item.full_text || item.summary).join('\n')
  if (combinedText.length < 300) {
    console.log('Base RSS materials are weak, using fallback pages...')
    for (const url of config.fallback_urls || []) {
      const markdown = await jinaRead(url, 6000)
      if (markdown.length <= 200) continue
      materials.push({
        source_type: 'rss',
        source_name: 'Fallback',
        title: url,
        url,
        published_at: '',
        lang: 'en',
        summary: trimText(markdown, 300),
        full_text: removeBoilerplate(markdown),
        score: 0.35,
        evidence_snippets: [trimText(markdown, 180)],
      })
    }
  }

  return dedupeResearchItems(materials)
}

function compactResearchItem(item) {
  return {
    source_type: item.source_type,
    source_name: item.source_name,
    title: item.title,
    url: item.url,
    published_at: item.published_at,
    lang: item.lang,
    summary: trimText(item.summary || item.full_text, 260),
    score: item.score,
    evidence_snippets: (item.evidence_snippets || []).slice(0, 2),
  }
}

function buildResearchPack({ baseItems, blogItems, paperItems }) {
  const sources = dedupeResearchItems([
    ...(baseItems || []),
    ...(blogItems || []),
    ...(paperItems || []),
  ])

  return {
    summary: {
      base_count: baseItems.length,
      blogwatcher_count: blogItems.length,
      paper_count: paperItems.length,
      total_sources: sources.length,
    },
    base_items: baseItems.map(compactResearchItem),
    blog_items: blogItems.map(compactResearchItem),
    paper_items: paperItems.map(compactResearchItem),
    sources: sources.map(compactResearchItem),
  }
}

function stringifyPromptPayload(payload, maxChars = 18000) {
  return smartTruncate(JSON.stringify(payload, null, 2), maxChars)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonFromLlm(raw) {
  let text = String(raw || '').trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/m, '')
  }
  return JSON.parse(text)
}

async function callLLM(systemPrompt, userPrompt, maxTokens = 16384) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error('Missing SILICONFLOW_API_KEY')
  }

  const url = `${SILICONFLOW_BASE_URL}/chat/completions`
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  let lastError = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) {
      const sec = [0, 10, 30, 60][attempt - 1]
      console.log(`Retrying LLM call in ${sec}s...`)
      await sleep(sec * 1000)
    }

    let response = null
    let errText = ''
    for (const jsonMode of [true, false]) {
      const body = {
        model: SILICONFLOW_MODEL,
        messages,
        temperature: 0.55,
        top_p: 0.9,
        max_tokens: maxTokens,
      }
      if (jsonMode) body.response_format = { type: 'json_object' }

      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      errText = await response.clone().text()
      if (response.ok) break
      if (jsonMode && response.status === 400) continue
      break
    }

    if (!response.ok) {
      lastError = errText
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication failed: ${response.status} ${errText.slice(0, 300)}`)
      }
      if (response.status === 429 || response.status >= 500) continue
      throw new Error(`LLM API error: ${response.status} ${errText.slice(0, 400)}`)
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content
    if (!raw) {
      lastError = 'empty llm content'
      continue
    }
    try {
      return parseJsonFromLlm(raw)
    } catch {
      lastError = `JSON parse failed: ${String(raw).slice(0, 200)}`
    }
  }

  throw new Error(`LLM failed after retries: ${lastError.slice(0, 500)}`)
}

async function chooseTopic({ researchPack, formatProfile, today }) {
  const system = [
    '你是一位资深中文科技博客作者兼选题编辑。',
    '你的任务不是罗列新闻，而是从素材里挑出一条最值得展开的主线。',
    '',
    '请输出一个 JSON，键必须是：',
    'topic, thesis, keywords, arxiv_queries, outline, image_sections, key_sources, tags, cover_prompt',
    '',
    '要求：',
    '- outline 必须优先使用以下章节骨架，并允许同名章节下增加少量三级子标题。',
    ...formatProfile.required_sections.map((section) => `- ${section}`),
    '- image_sections 最多 3 个，只能从 outline 里挑。',
    '- thesis 是一句明确判断，不是摘要。',
    '- key_sources 用标题或 URL 标识真正重要的来源。',
    '- cover_prompt 只用于 Grok 封面图，不要提及正文插图。',
  ].join('\n')

  const user = [
    `日期：${today}`,
    '',
    '博客格式规范：',
    buildFormatPrompt(formatProfile),
    '',
    '研究包：',
    stringifyPromptPayload(researchPack, 14000),
  ].join('\n')

  return callLLM(system, user, 3072)
}

async function generateArticle({ outline, researchPack, formatProfile, today }) {
  const system = [
    '# Role',
    '你是中文技术博客作者，文章直接发布到个人技术博客。',
    '',
    '# 输出格式',
    '只返回一个 JSON，对象键固定为：title, slug, summary, content_md, tags, takeaway。',
    '',
    '# 正文要求',
    '- content_md 必须包含以下五个二级标题，且按顺序出现：',
    ...formatProfile.required_sections.map((section) => `- ${section}`),
    '- 暂时不要输出“参考来源”“图片来源”“一句话结论”三个尾部章节，这三部分由程序补齐。',
    '- 正文要区分事实与观点，至少做两处对比、影响或取舍分析。',
    '- 如果 researchPack 中存在论文素材，必须解释论文与现实产品、新闻或工程实践的关系。',
    '- 禁止写成新闻罗列，禁止无来源结论。',
    '- 禁止让正文插图逻辑影响封面图内容。',
    '- slug 必须返回 ai-daily-' + today,
    '- summary 不超过 50 字，不要以“本文将”开头。',
    '- takeaway 是一句简短结论，后续会被用于“一句话结论”区块。',
    '',
    '# 禁用套话',
    ...formatProfile.banned_phrases.map((phrase) => `- ${phrase}`),
  ].join('\n')

  const user = [
    `日期：${today}`,
    '',
    '写作规范：',
    buildFormatPrompt(formatProfile),
    '',
    '选题与大纲：',
    stringifyPromptPayload(outline, 4000),
    '',
    '研究包：',
    stringifyPromptPayload(researchPack, 16000),
  ].join('\n')

  return callLLM(system, user, 16384)
}

function canRepairQualityGate(gate) {
  const repairablePrefixes = [
    'chars:',
    'analysis_signals:',
    'missing_sections:',
    'banned_phrases:',
  ]

  return gate.reasons.length > 0
    && gate.reasons.every((reason) => repairablePrefixes.some((prefix) => reason.startsWith(prefix)))
}

async function repairArticle({
  post,
  outline,
  researchPack,
  formatProfile,
  config,
  today,
  gate,
  attempt,
}) {
  const minChars = Math.max((config.quality_gate?.min_chars || 2200) + 400, 2600)
  const minAnalysisSignals = Math.max(config.quality_gate?.min_analysis_signals || 2, 2)

  const system = [
    '# Role',
    'You are revising a Chinese tech blog post that failed an automated quality gate.',
    '',
    '# Output format',
    'Return only one JSON object with keys: title, slug, summary, content_md, tags, takeaway.',
    '',
    '# Revision goals',
    '- Keep the article in Simplified Chinese.',
    '- Keep the same topic, core thesis, and source grounding.',
    `- Expand content_md so the article body is likely above ${minChars} Chinese characters before references are appended.`,
    '- Every required section should contain at least 2 substantial paragraphs, and key sections may use 3-4 paragraphs.',
    `- Include at least ${minAnalysisSignals} explicit analytical turns using phrases such as ${(formatProfile.analysis_markers || []).slice(0, 8).join(' / ')}.`,
    '- Add comparison, impact, trade-off, cost, or implementation discussion instead of repeating facts.',
    '- If any required section is thin, rewrite and expand it rather than adding filler.',
    '- Keep the tail sections absent; the program will append them.',
    `- slug must remain ai-daily-${today}.`,
  ].join('\n')

  const user = [
    `Repair attempt: ${attempt}`,
    '',
    'Quality gate failures:',
    ...gate.reasons.map((reason) => `- ${reason}`),
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
    '',
    'Outline:',
    stringifyPromptPayload(outline, 4000),
    '',
    'Research pack:',
    stringifyPromptPayload(researchPack, 14000),
    '',
    'Current article JSON:',
    stringifyPromptPayload(post, 14000),
    '',
    'Revise the article so it becomes longer, more analytical, and more publishable while preserving the topic and evidence.',
  ].join('\n')

  return callLLM(system, user, 16384)
}

async function downloadAndUploadImage(imageUrl, token) {
  try {
    const resp = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoBlogBot/3.0)' },
    })
    if (!resp.ok) return null
    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return null
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length < 1000 || buffer.length > 5 * 1024 * 1024) return null

    const ext = contentType.includes('png')
      ? '.png'
      : contentType.includes('gif')
        ? '.gif'
        : contentType.includes('webp')
          ? '.webp'
          : '.jpg'

    const filename = `auto-blog-${Date.now()}${ext}`
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
      signal: AbortSignal.timeout(15000),
    })
    if (!uploadResp.ok) return null
    const data = await uploadResp.json()
    return data.url?.startsWith('http') ? data.url : `${BLOG_API_BASE}${data.url}`
  } catch {
    return null
  }
}

async function generateCoverWithGrok(prompt, token) {
  if (!XAI_API_KEY) return null
  try {
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
    if (!resp.ok) return null
    const data = await resp.json()
    const grokUrl = data.data?.[0]?.url
    if (!grokUrl) return null
    return downloadAndUploadImage(grokUrl, token)
  } catch {
    return null
  }
}

async function getAdminToken() {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  })
  if (!resp.ok) throw new Error(`Admin login failed: ${resp.status}`)
  return (await resp.json()).access_token
}

async function checkSlugExists(slug) {
  try {
    return (await fetch(`${BLOG_API_BASE}/api/posts/${slug}`)).ok
  } catch {
    return false
  }
}

function truncateSummary(summary, max = 50) {
  const chars = Array.from(String(summary || '').trim())
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('')
}

function buildReferencesSection(researchPack) {
  const lines = ['## 参考来源']
  const sourceLines = (researchPack.sources || []).slice(0, 12).map((item) => {
    const label = `${item.source_name} / ${item.source_type}`
    return `- [${item.title}](${item.url}) - ${label}${item.published_at ? ` - ${item.published_at}` : ''}`
  })
  return `${lines.join('\n')}\n\n${sourceLines.join('\n') || '- 无'}`
}

function buildImageSourcesSection(imagePlans) {
  const lines = ['## 图片来源']
  const body = imagePlans.length > 0
    ? imagePlans.map((plan) => `- ${plan.section_heading}: [${plan.source_name}](${plan.source_page_url})`)
    : ['- 无正文插图']
  return `${lines.join('\n')}\n\n${body.join('\n')}`
}

function buildTakeawaySection(post, outline) {
  const takeaway = normalizeWhitespace(post.takeaway || outline.thesis || post.summary || outline.topic)
  return `## 一句话结论\n\n${takeaway}`
}

function normalizeHeadingLabel(heading) {
  return String(heading || '').replace(/^#{1,6}\s*/, '').trim()
}

function buildTakeawayQuote(post, outline) {
  const takeaway = normalizeWhitespace(post.takeaway || outline.thesis || post.summary || outline.topic)
  return `> ${takeaway}`
}

function insertImagesIntoContent(contentMd, imagePlans) {
  const lines = String(contentMd || '').split('\n')
  for (const plan of imagePlans) {
    const target = normalizeHeadingLabel(plan.section_heading)
    const imageMarkdown = `![${plan.alt_text || 'article image'}](${plan.image_url})`
    const headingIndex = lines.findIndex((line) => {
      const match = line.match(/^(#{1,6})\s+(.*)$/)
      if (!match) return false
      const current = match[2].trim()
      return current === target
        || current.startsWith(`${target}：`)
        || current.startsWith(`${target}:`)
        || current.startsWith(`${target} -`)
        || current.startsWith(`${target} `)
    })

    if (headingIndex === -1) continue

    const nearbyLines = lines.slice(headingIndex + 1, headingIndex + 5).join('\n')
    if (nearbyLines.includes(plan.image_url)) continue

    lines.splice(headingIndex + 1, 0, '', imageMarkdown, '')
  }
  return lines.join('\n')
}

function finalizeArticle({ post, outline, researchPack, imagePlans }) {
  const mainContent = String(post.content_md || '').trim()
  const withImages = insertImagesIntoContent(mainContent, imagePlans)
  return [
    withImages,
    buildReferencesSection(researchPack),
    buildImageSourcesSection(imagePlans),
    buildTakeawayQuote(post, outline),
  ].join('\n\n')
}

function normalizeForApi(post, fixedSlug, outline) {
  if (!post.title || !post.content_md) {
    throw new Error('LLM output missing title or content_md')
  }

  const slug = fixedSlug || String(post.slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'ai-daily-post'

  const title = String(post.title).slice(0, 200)
  let summary = truncateSummary(post.summary || '', 50)
  if (!summary) summary = 'AI 技术动态与开发者生态观察。'

  const rawTags = [
    ...(Array.isArray(post.tags) ? post.tags : []),
    ...(Array.isArray(outline.tags) ? outline.tags : []),
    'ai',
  ]
  const tags = [...new Set(rawTags
    .map((tag) => String(tag).toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 48))
    .filter(Boolean))]
    .slice(0, 8)

  return {
    title,
    slug,
    summary,
    content_md: String(post.content_md),
    tags: tags.length > 0 ? tags : ['ai'],
  }
}

async function publishPost(token, payload, coverImage = '') {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: payload.title,
      slug: payload.slug,
      summary: payload.summary,
      content_md: payload.content_md,
      tags: payload.tags,
      is_published: true,
      is_pinned: false,
      cover_image: coverImage,
    }),
  })
  if (!resp.ok) {
    throw new Error(`Publish failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function localizeImagePlans(imagePlans, token) {
  const localizedPlans = []

  for (const plan of imagePlans || []) {
    const uploadedUrl = await downloadAndUploadImage(plan.image_url, token)
    localizedPlans.push({
      ...plan,
      image_url: uploadedUrl || plan.image_url,
      uploaded_image_url: uploadedUrl || '',
    })
  }

  return localizedPlans
}

async function main() {
  console.log('Auto blog v3 starting...')
  const today = new Date().toISOString().split('T')[0]
  const slug = `ai-daily-${today}`

  if (!SILICONFLOW_API_KEY) throw new Error('Missing SILICONFLOW_API_KEY')
  if (!ADMIN_PASSWORD && !DRY_RUN) throw new Error('Missing ADMIN_PASSWORD')

  const config = await loadConfig()
  const formatProfile = getBlogFormatProfile(config.format_profile)

  if (!DRY_RUN && (await checkSlugExists(slug))) {
    console.log(`Slug already exists: ${slug}`)
    return
  }

  const baseItems = await collectBaseMaterials(config)
  if (baseItems.length === 0) {
    throw new Error('No usable base research items were collected')
  }

  let blogItems = []
  if (config.blogwatcher_enabled) {
    blogItems = await runBlogwatcher({ config, maxItems: 10 })
  }

  const preResearchPack = buildResearchPack({ baseItems, blogItems, paperItems: [] })
  const outline = await chooseTopic({
    researchPack: preResearchPack,
    formatProfile,
    today,
  })

  const arxivKeywords = normalizeKeywords(outline.arxiv_queries || outline.keywords || [])
  let paperItems = []
  if (config.arxiv_enabled && arxivKeywords.length > 0) {
    paperItems = await runArxiv({
      keywords: arxivKeywords,
      maxPapers: config.arxiv_max_papers || 2,
    })
  }

  const researchPack = buildResearchPack({ baseItems, blogItems, paperItems })
  const desiredImageSections = (Array.isArray(outline.image_sections) ? outline.image_sections : [])
    .filter((heading) => formatProfile.required_sections.includes(heading))
    .slice(0, config.image_selection_rules?.max_images || 0)

  let imagePlans = []
  if (config.source_image_picker_enabled && desiredImageSections.length > 0) {
    imagePlans = await pickSourceImages({
      sections: desiredImageSections,
      topic: outline.topic,
      sourceItems: researchPack.sources.filter((item) => (
        (config.image_selection_rules?.allowed_source_types || []).includes(item.source_type)
      )),
      config,
    })
  }

  let generatedPost = await generateArticle({
    outline,
    researchPack,
    formatProfile,
    today,
  })
  const maxRepairAttempts = Math.max(0, Number(config.quality_gate?.max_repair_attempts ?? 2))

  let postForGate = null
  let gate = null

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    const finalizedContent = finalizeArticle({
      post: generatedPost,
      outline,
      researchPack,
      imagePlans,
    })

    postForGate = {
      ...generatedPost,
      content_md: finalizedContent,
    }

    gate = evaluateQualityGate({
      post: postForGate,
      researchPack,
      formatProfile,
      config,
    })
    console.log(`Quality gate attempt ${attempt + 1}: ${formatQualityGateReport(gate)}`)

    if (gate.passed) break
    if (attempt >= maxRepairAttempts || !canRepairQualityGate(gate)) break

    console.log(`Repairing article after quality gate failure (${attempt + 1}/${maxRepairAttempts})...`)
    generatedPost = await repairArticle({
      post: generatedPost,
      outline,
      researchPack,
      formatProfile,
      config,
      today,
      gate,
      attempt: attempt + 1,
    })
  }

  if (!gate.passed) {
    const message = `Quality gate failed after repair attempts: ${gate.reasons.join(', ')}`
    if (DRY_RUN) {
      throw new Error(message)
    }
    console.log(`Skipping publish: ${message}`)
    return
  }

  let token = null
  if (!DRY_RUN) {
    token = await getAdminToken()
  }

  let publishImagePlans = imagePlans
  let publishPostForApi = postForGate
  if (!DRY_RUN && token && imagePlans.length > 0) {
    publishImagePlans = await localizeImagePlans(imagePlans, token)
    publishPostForApi = {
      ...generatedPost,
      content_md: finalizeArticle({
        post: generatedPost,
        outline,
        researchPack,
        imagePlans: publishImagePlans,
      }),
    }
  }

  const apiBody = normalizeForApi(publishPostForApi, slug, outline)

  let coverImage = ''
  if (XAI_API_KEY && token && outline.cover_prompt) {
    console.log('Generating Grok cover image...')
    coverImage = await generateCoverWithGrok(outline.cover_prompt, token) || ''
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({
      outline,
      research_pack: researchPack,
      image_plans: publishImagePlans,
      quality_gate: gate,
      post: apiBody,
      cover_image: coverImage || null,
    }, null, 2))
    return
  }

  const result = await publishPost(token, apiBody, coverImage)
  console.log(`Published successfully: id=${result.id} slug=${apiBody.slug}`)
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
