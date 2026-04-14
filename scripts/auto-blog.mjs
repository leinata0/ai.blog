#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseFeedXml, dedupeResearchItems, runBlogwatcher } from './lib/blogwatcher.mjs'
import { runArxiv } from './lib/arxiv.mjs'
import {
  getBlogFormatProfile,
  buildFormatPrompt,
  getContentWorkflowProfile,
  resolveFormatProfileName,
} from './lib/blog-format.mjs'
import { evaluateQualityGate, formatQualityGateReport } from './lib/quality-gate.mjs'
import { pickSourceImages } from './lib/source-image-picker.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY?.trim()
const SILICONFLOW_BASE_URL = (
  process.env.SILICONFLOW_BASE_URL?.trim() || 'https://api.siliconflow.cn/v1'
).replace(/\/$/, '')
const SILICONFLOW_MODEL = process.env.SILICONFLOW_MODEL?.trim() || 'deepseek-ai/DeepSeek-V3'
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const BLOG_API_BASE = process.env.BLOG_API_BASE || 'https://ai-blog-hbur.onrender.com'
const XAI_API_KEY = process.env.XAI_API_KEY?.trim() || ''
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')

const DEFAULT_DAILY_REQUIRED_SECTIONS = [
  '## 发生了什么',
  '## 为什么值得关注',
  '## 这件事可能带来的影响',
]

const DEFAULT_DAILY_TAIL_SECTIONS = ['## 参考来源', '## 图片来源']

const DAILY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will',
  'with', 'about', 'after', 'before', 'over', 'under', 'launch', 'launches', 'released',
  'release', 'announces', 'announced', 'introduces', 'introduce', 'new', 'latest', 'today',
  'daily', 'report', 'update', 'updates', 'breaking', 'says', 'say', 'ai', 'llm', 'model',
  'models', 'china', 'openai', 'anthropic', 'google', 'meta', 'microsoft',
])

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

function scoreTimestamp(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function slugify(value, fallback = 'topic') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (!normalized) return fallback
  return normalized.replace(/[\u4e00-\u9fff]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || fallback
}

function tokenizeTopicText(value) {
  const raw = String(value || '').toLowerCase()
  const matches = raw.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  return matches.map((token) => token.trim()).filter((token) => token && !DAILY_STOP_WORDS.has(token))
}

function buildTokenSignature(item) {
  const tokens = tokenizeTopicText([item?.title || '', item?.summary || '', item?.full_text || ''].join(' '))
  return [...new Set(tokens)].slice(0, 12)
}

function countTokenOverlap(left, right) {
  const set = new Set(left)
  return right.reduce((count, token) => count + (set.has(token) ? 1 : 0), 0)
}

function computeTopicSimilarity(leftTokens, rightTokens) {
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0
  return countTokenOverlap(leftTokens, rightTokens) / Math.min(leftTokens.length, rightTokens.length)
}

function itemRelevanceScore(item) {
  const baseScore = Number(item?.score || 0)
  const freshnessScore = scoreTimestamp(item?.published_at) / 1_000_000_000_000
  const textScore = Math.min(String(item?.full_text || item?.summary || '').length / 1200, 1)
  return Number((baseScore * 3 + freshnessScore + textScore).toFixed(4))
}

export function buildTopicKey(value) {
  const source = typeof value === 'string' ? { title: value } : value
  const signature = buildTokenSignature(source)
  if (signature.length > 0) {
    return slugify(signature.slice(0, 6).join('-'), 'daily-topic').slice(0, 80)
  }
  return slugify(source?.title || source?.url || 'daily-topic', 'daily-topic').slice(0, 80)
}

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = { dryRun: false, mode: null, maxPosts: null, coverageDate: null, force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--force') options.force = true
    else if (current === '--mode' && argv[index + 1]) options.mode = argv[++index]
    else if (current.startsWith('--mode=')) options.mode = current.split('=')[1]
    else if (current === '--max-posts' && argv[index + 1]) options.maxPosts = Number(argv[++index])
    else if (current.startsWith('--max-posts=')) options.maxPosts = Number(current.split('=')[1])
    else if (current === '--coverage-date' && argv[index + 1]) options.coverageDate = argv[++index]
    else if (current.startsWith('--coverage-date=')) options.coverageDate = current.split('=')[1]
  }
  return options
}

function toCoverageDate(input) {
  return input || new Date().toISOString().slice(0, 10)
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

export function clusterResearchItemsByTopic(items, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.5
  const sorted = [...(items || []).filter((item) => item?.url)]
    .sort((left, right) => itemRelevanceScore(right) - itemRelevanceScore(left))
  const clusters = []

  for (const item of sorted) {
    const signature = buildTokenSignature(item)
    const titleKey = slugify(item.title, 'topic')
    let targetCluster = null

    for (const cluster of clusters) {
      const similarity = computeTopicSimilarity(signature, cluster.signature)
      if (similarity >= similarityThreshold || titleKey === cluster.title_key) {
        targetCluster = cluster
        break
      }
    }

    if (!targetCluster) {
      targetCluster = { title_key: titleKey, signature, items: [] }
      clusters.push(targetCluster)
    }

    targetCluster.items.push(item)
    targetCluster.signature = [...new Set([...targetCluster.signature, ...signature])].slice(0, 14)
  }

  return clusters.map((cluster) => {
    const orderedItems = [...cluster.items].sort((left, right) => itemRelevanceScore(right) - itemRelevanceScore(left))
    const lead = orderedItems[0]
    const sources = new Set(orderedItems.map((item) => `${item.source_name}:${item.url}`))
    return {
      topic_key: buildTopicKey(lead),
      title_key: cluster.title_key,
      candidate_title: lead?.title || 'AI 主题',
      lead_source_name: lead?.source_name || '',
      latest_published_at: orderedItems.map((item) => item.published_at).sort((left, right) => scoreTimestamp(right) - scoreTimestamp(left))[0] || '',
      score: Number(orderedItems.reduce((total, item) => total + itemRelevanceScore(item), 0).toFixed(4)),
      source_count: sources.size,
      keywords: cluster.signature.slice(0, 8),
      items: orderedItems,
    }
  }).sort((left, right) => {
    if (right.source_count !== left.source_count) return right.source_count - left.source_count
    if (right.score !== left.score) return right.score - left.score
    return scoreTimestamp(right.latest_published_at) - scoreTimestamp(left.latest_published_at)
  })
}

function inferTopicKeyFromSlug(slug, coverageDate) {
  const prefix = `ai-brief-${coverageDate}-`
  return String(slug || '').startsWith(prefix) ? String(slug).slice(prefix.length) : ''
}

async function fetchPublishedTopicKeys({ coverageDate }) {
  const topicKeys = new Set()
  let page = 1
  const pageSize = 50

  while (page <= 4) {
    let response
    try {
      response = await fetch(`${BLOG_API_BASE}/api/posts?page=${page}&page_size=${pageSize}`, {
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      break
    }

    if (!response.ok) break
    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    for (const post of items) {
      const topicKey = post.topic_key || inferTopicKeyFromSlug(post.slug, coverageDate)
      if (topicKey) topicKeys.add(topicKey)
    }
    if (items.length < pageSize) break
    page += 1
  }

  return topicKeys
}

export function selectTopicsForPublishing(topics, runtime) {
  const publishedTopicKeys = runtime.publishedTopicKeys || new Set()
  const maxPosts = Math.max(1, Number(runtime.maxPosts || 1))
  const minSourcesSoft = Math.max(1, Number(runtime.minSourcesPerTopic || 1))

  const queue = [...(topics || [])]
    .filter((topic) => topic.items?.length > 0)
    .filter((topic) => !publishedTopicKeys.has(topic.topic_key))
    .sort((left, right) => {
      const leftBoost = left.source_count >= minSourcesSoft ? 1 : 0
      const rightBoost = right.source_count >= minSourcesSoft ? 1 : 0
      if (rightBoost !== leftBoost) return rightBoost - leftBoost
      if (right.source_count !== left.source_count) return right.source_count - left.source_count
      if (right.score !== left.score) return right.score - left.score
      return scoreTimestamp(right.latest_published_at) - scoreTimestamp(left.latest_published_at)
    })

  return { queue, target_count: maxPosts, skipped_topic_keys: [...publishedTopicKeys] }
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

export function createDailyBriefFormatProfile() {
  const baseProfile = getBlogFormatProfile('tech-editorial-v1')
  return {
    ...baseProfile,
    name: 'daily_brief',
    required_sections: [...DEFAULT_DAILY_REQUIRED_SECTIONS],
    required_tail_sections: [...DEFAULT_DAILY_TAIL_SECTIONS],
    title_rules: [
      '标题必须是中文，避免“日报”“快讯”式口吻。',
      '标题应体现判断或变化，而不是只复述消息。',
      '标题长度控制在 12-30 个中文字符。',
    ],
    summary_rules: [
      '摘要只写一段，直接告诉读者最重要的变化。',
      '摘要不要以“本文将”或“这篇文章”开头。',
      '摘要不超过 80 个中文字符。',
    ],
    style_rules: [
      '这是一篇单主题快评稿，不要写成消息堆砌。',
      '必须区分事实、判断和潜在影响。',
      '至少给出两处影响、取舍、成本或竞争格局分析。',
    ],
  }
}

function resolveDailyRuntime(config, cliOptions) {
  const mode = cliOptions.mode || config.default_mode || 'daily-auto'
  const dailyConfig = config.daily_auto || {}
  const manualConfig = config.daily_manual || {}
  const modeConfig = mode === 'daily-manual' ? manualConfig : dailyConfig

  return {
    mode,
    dryRun: cliOptions.dryRun,
    coverageDate: toCoverageDate(cliOptions.coverageDate),
    maxPosts: Math.max(1, Number(cliOptions.maxPosts || modeConfig.max_posts_per_run || dailyConfig.max_posts_per_run || 2)),
    lookbackHours: Number(modeConfig.lookback_hours || dailyConfig.lookback_hours || 30),
    maxCandidateItems: Number(modeConfig.max_candidate_items || dailyConfig.max_candidate_items || 24),
    minSourcesPerTopic: Number(modeConfig.min_sources_per_topic || dailyConfig.min_sources_per_topic || 2),
    clusterSimilarityThreshold: Number(modeConfig.cluster_similarity_threshold || dailyConfig.cluster_similarity_threshold || 0.5),
    enableBlogwatcherFallback: Boolean(modeConfig.enable_blogwatcher_fallback ?? dailyConfig.enable_blogwatcher_fallback ?? false),
    skipPublishedTopicKeys: Boolean(modeConfig.skip_published_topic_keys ?? true),
    force: cliOptions.force,
  }
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

async function generateArticle({ outline, researchPack, formatProfile, workflow, today }) {
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
    `- slug 必须返回 ${workflow.slug}`,
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
  workflow,
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
    `- slug must remain ${workflow.slug}.`,
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

function buildMetadataComment(metadata) {
  return `<!-- auto-blog-meta: ${JSON.stringify(metadata)} -->`
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

function finalizeArticle({ post, outline, researchPack, imagePlans, metadata = null }) {
  const mainContent = String(post.content_md || '').trim()
  const withImages = insertImagesIntoContent(mainContent, imagePlans)
  const sections = [
    withImages,
    buildReferencesSection(researchPack),
    buildImageSourcesSection(imagePlans),
    buildTakeawayQuote(post, outline),
  ]
  if (metadata) sections.push(buildMetadataComment(metadata))
  return sections.join('\n\n')
}

function normalizeForApi(post, fixedSlug, outline, metadata = {}) {
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
    content_type: metadata.content_type || 'post',
    topic_key: metadata.topic_key || '',
    published_mode: metadata.published_mode || 'manual',
    coverage_date: metadata.coverage_date || '',
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
      content_type: payload.content_type,
      topic_key: payload.topic_key,
      published_mode: payload.published_mode,
      coverage_date: payload.coverage_date,
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

function createTopicSnapshot(topic, overrides = {}) {
  return {
    topic_key: overrides.topic_key ?? topic?.topic_key ?? '',
    title: overrides.title ?? topic?.candidate_title ?? topic?.title ?? '未命名主题',
    summary: overrides.summary ?? topic?.summary ?? '',
    source_count: overrides.source_count ?? topic?.source_count ?? 0,
    source_names: overrides.source_names ?? (
      Array.isArray(topic?.items)
        ? [...new Set(topic.items.map((item) => item.source_name).filter(Boolean))]
        : []
    ),
    content_type: overrides.content_type ?? topic?.content_type ?? '',
    published_mode: overrides.published_mode ?? topic?.published_mode ?? '',
    post_slug: overrides.post_slug ?? topic?.post_slug ?? '',
    reason: overrides.reason ?? topic?.reason ?? '',
    status: overrides.status ?? topic?.status ?? '',
  }
}

async function upsertPublishingStatus(token, payload) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/publishing-status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    throw new Error(`Publishing status update failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function reportPublishingRun(token, payload) {
  if (!token || !payload) return null
  try {
    return await upsertPublishingStatus(token, payload)
  } catch (error) {
    console.warn(`Failed to update publishing status: ${error.message}`)
    return null
  }
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

async function buildPublishablePost({
  outline,
  researchPack,
  formatProfile,
  config,
  today,
  metadata,
  fixedSlug,
  workflow = null,
}) {
  const workflowProfile = workflow || {
    slug: fixedSlug || `ai-brief-${today}`,
    content_type: metadata?.content_type || 'daily_brief',
  }
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
    workflow: workflowProfile,
    today,
  })

  const gateConfig = config.quality_gate?.[metadata.content_type] || config.quality_gate || {}
  const maxRepairAttempts = Math.max(0, Number(gateConfig.max_repair_attempts ?? 2))
  let postForGate = null
  let gate = null

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    const finalizedContent = finalizeArticle({
      post: generatedPost,
      outline,
      researchPack,
      imagePlans,
      metadata,
    })

    postForGate = {
      ...generatedPost,
      gate_profile: metadata.content_type,
      content_type: metadata.content_type,
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
      workflow: workflowProfile,
      config,
      today,
      gate,
      attempt: attempt + 1,
    })
  }

  if (!gate.passed) {
    throw new Error(`Quality gate failed after repair attempts: ${gate.reasons.join(', ')}`)
  }

  return {
    outline,
    researchPack,
    imagePlans,
    gate,
    post: normalizeForApi(postForGate, fixedSlug, outline, metadata),
  }
}

async function runDailyMode(config, cliOptions) {
  const runtime = resolveDailyRuntime(config, cliOptions)
  const baseItems = await collectBaseMaterials(config)
  if (baseItems.length === 0) {
    throw new Error('No usable base research items were collected')
  }

  const coverageDate = runtime.coverageDate
  const formatProfile = createDailyBriefFormatProfile()
  const workflow = getContentWorkflowProfile(config, runtime.mode, coverageDate)
  const clusteredTopics = clusterResearchItemsByTopic(baseItems.slice(0, runtime.maxCandidateItems), {
    similarityThreshold: runtime.clusterSimilarityThreshold,
  })
  const publishedTopicKeys = runtime.skipPublishedTopicKeys && !runtime.force && !runtime.dryRun
    ? await fetchPublishedTopicKeys({ coverageDate })
    : new Set()
  const selection = selectTopicsForPublishing(clusteredTopics, {
    maxPosts: runtime.maxPosts,
    minSourcesPerTopic: runtime.minSourcesPerTopic,
    publishedTopicKeys,
  })

  const selectedTopics = selection.queue.slice(0, selection.target_count)
  const token = runtime.dryRun ? null : await getAdminToken()
  const candidateTopics = clusteredTopics.map((topic) => createTopicSnapshot(topic, {
    content_type: workflow.content_type,
  }))
  const skippedTopics = []
  const results = []

  if (selectedTopics.length === 0) {
    console.log('No eligible topics to publish for this coverage date.')
    if (!runtime.dryRun) {
      await reportPublishingRun(token, {
        workflow_key: runtime.mode.replace('-', '_'),
        external_run_id: process.env.GITHUB_RUN_ID || '',
        run_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
        status: 'skipped',
        coverage_date: coverageDate,
        message: 'No eligible topics to publish for this coverage date.',
        candidate_topics: candidateTopics,
        published_topics: [],
        skipped_topics: selection.skipped_topic_keys.map((topicKey) => createTopicSnapshot(
          clusteredTopics.find((topic) => topic.topic_key === topicKey),
          {
            topic_key: topicKey,
            content_type: workflow.content_type,
            reason: 'already published for coverage date',
            status: 'skipped',
          }
        )),
      })
    }
    return []
  }

  for (const topic of selectedTopics) {
    const topicBlogItems = runtime.enableBlogwatcherFallback && config.blogwatcher_enabled
      ? await runBlogwatcher({ config, topicHint: topic.candidate_title, maxItems: 6, mode: runtime.mode })
      : []
    const researchPack = buildResearchPack({ baseItems: topic.items, blogItems: topicBlogItems, paperItems: [] })
    const outline = await chooseTopic({
      researchPack,
      formatProfile,
      today: coverageDate,
    })
    const metadata = {
      content_type: workflow.content_type,
      topic_key: topic.topic_key,
      published_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
      coverage_date: coverageDate,
    }
    const slug = `${workflow.slug}-${topic.topic_key}`.slice(0, 200)

    if (!runtime.dryRun && !runtime.force && (await checkSlugExists(slug))) {
      console.log(`Skipping existing slug: ${slug}`)
      skippedTopics.push(createTopicSnapshot(topic, {
        content_type: workflow.content_type,
        published_mode: metadata.published_mode,
        reason: 'slug already exists',
        status: 'skipped',
      }))
      continue
    }

    const artifact = await buildPublishablePost({
      outline,
      researchPack,
      formatProfile,
      config,
      today: coverageDate,
      metadata,
      fixedSlug: slug,
      workflow: {
        ...workflow,
        slug,
      },
    })

    let coverImage = ''
    if (XAI_API_KEY && token && artifact.outline.cover_prompt) {
      console.log(`Generating Grok cover image for ${slug}...`)
      coverImage = await generateCoverWithGrok(artifact.outline.cover_prompt, token) || ''
    }

    if (runtime.dryRun) {
      results.push({ ...artifact, cover_image: coverImage || null })
      continue
    }

    const result = await publishPost(token, artifact.post, coverImage)
    console.log(`Published daily brief: id=${result.id} slug=${artifact.post.slug}`)
    results.push({ ...artifact, result })
  }

  if (!runtime.dryRun) {
    const publishedTopics = results.map((item) => createTopicSnapshot(item.outline, {
      topic_key: item.post.topic_key,
      title: item.post.title,
      summary: item.post.summary,
      content_type: item.post.content_type,
      published_mode: item.post.published_mode,
      post_slug: item.post.slug,
      source_count: item.researchPack.sources.length,
      source_names: [...new Set(item.researchPack.sources.map((source) => source.source_name).filter(Boolean))],
      status: 'published',
    }))
    const publishedKeys = new Set(publishedTopics.map((topic) => topic.topic_key).filter(Boolean))
    const preSkippedTopics = selection.skipped_topic_keys
      .filter((topicKey) => !publishedKeys.has(topicKey))
      .map((topicKey) => createTopicSnapshot(
        clusteredTopics.find((topic) => topic.topic_key === topicKey),
        {
          topic_key: topicKey,
          content_type: workflow.content_type,
          reason: 'already published for coverage date',
          status: 'skipped',
        }
      ))

    await reportPublishingRun(token, {
      workflow_key: runtime.mode.replace('-', '_'),
      external_run_id: process.env.GITHUB_RUN_ID || '',
      run_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
      status: results.length > 0 ? 'success' : 'skipped',
      coverage_date: coverageDate,
      message: results.length > 0
        ? `Published ${results.length} post(s), skipped ${preSkippedTopics.length + skippedTopics.length} topic(s).`
        : 'No posts were published in this run.',
      candidate_topics: candidateTopics,
      published_topics: publishedTopics,
      skipped_topics: [...preSkippedTopics, ...skippedTopics],
    })
  }

  return results
}

async function runWeeklyReviewMode(config, cliOptions) {
  const today = toCoverageDate(cliOptions.coverageDate)
  const workflow = getContentWorkflowProfile(config, 'weekly-review', today)
  const slug = workflow.slug
  const formatProfile = getBlogFormatProfile(resolveFormatProfileName(config, 'weekly-review'))

  if (!cliOptions.dryRun && (await checkSlugExists(slug))) {
    console.log(`Slug already exists: ${slug}`)
    return []
  }

  const baseItems = await collectBaseMaterials(config)
  if (baseItems.length === 0) {
    throw new Error('No usable base research items were collected')
  }

  let blogItems = []
  if (config.blogwatcher_enabled || config.weekly_review?.blogwatcher_enabled) {
    blogItems = await runBlogwatcher({ config, maxItems: 10, mode: 'weekly-review' })
  }

  const preResearchPack = buildResearchPack({ baseItems, blogItems, paperItems: [] })
  const outline = await chooseTopic({ researchPack: preResearchPack, formatProfile, today })

  const arxivKeywords = normalizeKeywords(outline.arxiv_queries || outline.keywords || [])
  let paperItems = []
  if ((config.arxiv_enabled || config.weekly_review?.arxiv_enabled) && arxivKeywords.length > 0) {
    paperItems = await runArxiv({
      keywords: arxivKeywords,
      maxPapers: config.arxiv_max_papers || 2,
      config,
      mode: 'weekly-review',
    })
  }

  const researchPack = buildResearchPack({ baseItems, blogItems, paperItems })
  const metadata = {
    content_type: workflow.content_type,
    topic_key: buildTopicKey(outline.topic || slug),
    published_mode: 'auto',
    coverage_date: today,
  }
  const artifact = await buildPublishablePost({
    outline,
    researchPack,
    formatProfile,
    config,
    today,
    metadata,
    fixedSlug: slug,
    workflow,
  })

  if (cliOptions.dryRun) {
    return [{ ...artifact, cover_image: null }]
  }

  const token = await getAdminToken()
  let coverImage = ''
  if (XAI_API_KEY && token && outline.cover_prompt) {
    console.log('Generating Grok cover image...')
    coverImage = await generateCoverWithGrok(outline.cover_prompt, token) || ''
  }
  const result = await publishPost(token, artifact.post, coverImage)
  console.log(`Published weekly review: id=${result.id} slug=${artifact.post.slug}`)
  await reportPublishingRun(token, {
    workflow_key: 'weekly_review',
    external_run_id: process.env.GITHUB_RUN_ID || '',
    run_mode: 'auto',
    status: 'success',
    coverage_date: today,
    message: 'Weekly review published successfully.',
    candidate_topics: [
      createTopicSnapshot(outline, {
        topic_key: metadata.topic_key,
        title: artifact.post.title,
        summary: artifact.post.summary,
        content_type: workflow.content_type,
        source_count: researchPack.sources.length,
        source_names: [...new Set(researchPack.sources.map((source) => source.source_name).filter(Boolean))],
      }),
    ],
    published_topics: [
      createTopicSnapshot(outline, {
        topic_key: metadata.topic_key,
        title: artifact.post.title,
        summary: artifact.post.summary,
        content_type: artifact.post.content_type,
        published_mode: artifact.post.published_mode,
        post_slug: artifact.post.slug,
        source_count: researchPack.sources.length,
        source_names: [...new Set(researchPack.sources.map((source) => source.source_name).filter(Boolean))],
        status: 'published',
      }),
    ],
    skipped_topics: [],
  })
  return [{ ...artifact, result }]
}

async function main() {
  console.log('Auto blog v4 starting...')
  console.log(`Publishing target: ${BLOG_API_BASE}`)

  const cliOptions = parseCliArgs()
  const dryRun = cliOptions.dryRun

  if (!SILICONFLOW_API_KEY) throw new Error('Missing SILICONFLOW_API_KEY')
  if (!ADMIN_PASSWORD && !dryRun) throw new Error('Missing ADMIN_PASSWORD')

  const config = await loadConfig()
  const mode = cliOptions.mode || config.default_mode || 'daily-auto'
  const modeHandler = mode === 'weekly-review' ? runWeeklyReviewMode : runDailyMode
  const results = await modeHandler(config, cliOptions)

  if (dryRun) {
    console.log(JSON.stringify({
      mode,
      coverage_date: toCoverageDate(cliOptions.coverageDate),
      posts: results.map((item) => ({
        outline: item.outline,
        research_pack: item.researchPack,
        image_plans: item.imagePlans,
        quality_gate: item.gate,
        post: item.post,
        cover_image: item.cover_image || null,
      })),
    }, null, 2))
  }
}

const isMainModule = process.argv[1] ? resolve(process.argv[1]) === __filename : false

if (isMainModule) {
  main().catch((err) => {
    console.error(`Fatal error: ${err.message}`)
    if (err.stack) console.error(err.stack)
    process.exit(1)
  })
}
