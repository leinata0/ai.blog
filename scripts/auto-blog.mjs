#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applySourceDiversity,
  dedupeResearchItems,
  filterResearchItemsByPublishedWindow,
  mapWithConcurrency,
  parseFeedXml,
  readResponseTextCapped,
  resolveSourceDiversityConfig,
  runBlogwatcher,
} from './lib/blogwatcher.mjs'
import { runArxiv } from './lib/arxiv.mjs'
import {
  getBlogFormatProfile,
  buildFormatPrompt,
  getContentWorkflowProfile,
  resolveFormatProfileName,
  neutralizeBannedPhrases,
} from './lib/blog-format.mjs'
import {
  findAdminPostByExactSlug,
  resolveAdminPassword,
  resolveAdminUsername,
  resolveBlogApiBase,
} from './lib/blog-api.mjs'
import { buildPostCoverBrief } from './lib/cover-art.mjs'
import { countPhraseHits, evaluateQualityGate, formatQualityGateReport } from './lib/quality-gate.mjs'
import {
  generatePostCoverViaAdminJob,
  imageGenerationJobId,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
  waitForImageGenerationJob,
} from './lib/admin-image-generation.mjs'
import { generateTextViaAdminApi } from './lib/admin-text-generation.mjs'
import { classifyRejectedImageUrl, pickSourceImages } from './lib/source-image-picker.mjs'
import { extractMarkdownImageCandidates, mergeMediaCandidates } from './lib/feed-media.mjs'
import { localizeImagePlans as localizeInlineImagePlans } from './lib/image-localizer.mjs'
import {
  DAILY_STOP_WORDS,
  computeTopicSimilarity,
  countTokenOverlap,
  isLatinToken,
  stripMarkupForTokens,
  tokenizeTopicText,
} from './lib/topic-tokens.mjs'
import { isPublicHttpUrl } from './lib/url-guard.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ADMIN_USERNAME = resolveAdminUsername()
const ADMIN_PASSWORD = resolveAdminPassword()
const BLOG_API_BASE = resolveBlogApiBase()
const VERCEL_DEPLOY_HOOK_URL = process.env.VERCEL_DEPLOY_HOOK_URL?.trim() || ''
const CONFIG_PATH = process.env.AUTO_BLOG_CONFIG_PATH
  ? resolve(process.env.AUTO_BLOG_CONFIG_PATH)
  : resolve(__dirname, 'config', 'auto-blog.config.json')
const DEFAULT_SERIES_RULES_PATH = resolve(__dirname, 'config', 'series-assignment.rules.json')
const DEFAULT_TOPIC_PRESENTATION_RULES_PATH = resolve(__dirname, 'config', 'topic-presentation.rules.json')

let adminTokenCache = ''

const DEFAULT_DAILY_REQUIRED_SECTIONS = [
  '## 发生了什么',
  '## 为什么值得关注',
  '## 这件事可能带来的影响',
]

const DEFAULT_DAILY_TAIL_SECTIONS = ['## 参考来源', '## 图片来源', '## 一句话结论']

async function triggerFrontendRefresh(payload = {}) {
  if (!VERCEL_DEPLOY_HOOK_URL) return false

  const response = await fetch(VERCEL_DEPLOY_HOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) {
    throw new Error(`frontend refresh hook failed with ${response.status}`)
  }
  return true
}

async function triggerFrontendRefreshSafe(payload = {}) {
  if (!VERCEL_DEPLOY_HOOK_URL) return false
  try {
    await triggerFrontendRefresh(payload)
    console.log('Triggered frontend refresh hook.')
    return true
  } catch (error) {
    console.warn(`Frontend refresh hook warning: ${error.message}`)
    return false
  }
}

function trimText(value, max = 800) {
  const text = String(value || '').trim()
  return text.length <= max ? text : `${text.slice(0, max)}...`
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeUrlForLookup(value) {
  try {
    const url = new URL(String(value || '').trim())
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    url.hostname = url.hostname.toLowerCase()
    return url.toString().replace(/\/$/, '')
  } catch {
    return String(value || '').trim().toLowerCase().replace(/\/$/, '')
  }
}

function extractDomain(value) {
  try {
    return new URL(String(value || '').trim()).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function sourceFingerprint(item = {}) {
  const url = normalizeUrlForLookup(item.url || item.source_url || '')
  const title = normalizeWhitespace(item.title || '').toLowerCase()
  return `${url}|${title}`
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

export function normalizePublishedAt(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  const text = String(value || '').trim()
  if (!text) return null
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function buildPrimarySourceMatcher(keySources = []) {
  const keyHints = (Array.isArray(keySources) ? keySources : [])
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean)

  return {
    keyHints,
    matches(source = {}) {
      const sourceUrl = String(source?.url || source?.source_url || '').trim().toLowerCase()
      const title = String(source?.title || '').trim().toLowerCase()
      const sourceName = String(source?.source_name || '').trim().toLowerCase()
      return keyHints.some((hint) => (
        sourceUrl.includes(hint)
        || title.includes(hint)
        || sourceName.includes(hint)
      ))
    },
  }
}

function applyPrimarySourceHintsToSources(sourceItems = [], outline = {}) {
  const matcher = buildPrimarySourceMatcher(outline?.key_sources)
  return (Array.isArray(sourceItems) ? sourceItems : []).map((source, index) => ({
    ...source,
    is_primary: matcher.keyHints.length > 0 ? matcher.matches(source) : index === 0,
  }))
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

// tokenizeTopicText / stripMarkupForTokens / computeTopicSimilarity / isLatinToken /
// countTokenOverlap / DAILY_STOP_WORDS 都搬去了 lib/topic-tokens.mjs。blogwatcher 的兜底
// 相关性判定需要**同一套**分词，而它此前抄的是旧的一份（中文整段吞、没有标记停用词）——
// 那些误匹配到的条目会被日报的来源支持门槛当作正式来源计数，直接替单源选题凑出 3 来源。
// 这里只做转出口，既有测试的 import 路径不变。
export { tokenizeTopicText, computeTopicSimilarity }

// 二元切分让单条素材的 token 数翻好几倍，12 的旧上限只够覆盖标题前十几个字，
// 语义覆盖面反而比切分前更窄（实测：只上 bigram 不提 cap，生产池 45 个 pair 里非零
// 相似度从 15 对掉到 3 对，是负优化）。24 刚好覆盖完一个中文标题并给摘要留位。
// 注意：提 cap 必须和下面 computeTopicSimilarity 的分母封顶成对使用 —— 单独提 cap
// 只会把分母拉大，同题配对的分数反而下降（雷锋网×量子位 Opus 5 那对：0.30 → 0.125）。
// 改动任一常量后请重跑 topic-tokenizer 测试。
const TOPIC_SIGNATURE_LIMIT = 24
const CLUSTER_SIGNATURE_LIMIT = 28

// Jina reader 的输出固定带一段 `Title: / URL Source: / Published Time: / Markdown Content:`
// 抬头（本次抓取实测 20/20 条都有）。它对每一条素材都长得一样，等于给所有取过全文的素材
// 注入一组共同 token（title / url / source / markdown / content / published / time），把两篇
// 毫不相干的稿子拉出虚假相似度 —— 事故日志里 `...-source-title-url-...` 就是它。抬头里的
// 信息 item.title / item.url 上本来就有，分词前直接切掉。
function stripReaderPreamble(value) {
  return String(value || '').replace(/^\s*Title:\s[\s\S]{0,4000}?\n\s*Markdown Content:\s*/, '')
}

export function buildTokenSignature(item) {
  const tokens = tokenizeTopicText([
    item?.title || '',
    item?.summary || '',
    stripReaderPreamble(item?.full_text || ''),
  ].join(' '))
  return [...new Set(tokens)].slice(0, TOPIC_SIGNATURE_LIMIT)
}

// slugify 会剥掉全部汉字，所以任何要进 slug / topic_key 的「可读前缀」都必须优先挑拉丁与
// 数字 token，否则二元切分后的中文签名会被整段剥空，纯中文选题的 key 退化成裸指纹。
// 同一个函数也决定喂给 arXiv 的 keywords —— CJK 二元组对英文论文检索毫无意义。
function pickReadableSignatureTokens(tokens, limit) {
  const list = (Array.isArray(tokens) ? tokens : []).filter(Boolean)
  const latin = list.filter(isLatinToken)
  return (latin.length > 0 ? latin : list).slice(0, limit)
}

function itemRelevanceScore(item) {
  const baseScore = Number(item?.score || 0)
  const freshnessScore = scoreTimestamp(item?.published_at) / 1_000_000_000_000
  const textScore = Math.min(String(item?.full_text || item?.summary || '').length / 1200, 1)
  return Number((baseScore * 3 + freshnessScore + textScore).toFixed(4))
}

export function buildTopicKey(value) {
  const source = typeof value === 'string' ? { title: value } : value
  const signature = pickReadableSignatureTokens(buildTokenSignature(source), 6)
  if (signature.length > 0) {
    const key = slugify(signature.join('-'), '').slice(0, 80)
    if (key) return key
  }
  // 兜底走原标题，但要先洗一遍：不洗的话 `&#038;` 会在 slug 里留下一段 `038`。
  return slugify(stripMarkupForTokens(source?.title || '') || source?.url || 'daily-topic', 'daily-topic').slice(0, 80)
}

// The old key was derived from the cluster's *lead* item only. Clustering is order- and
// score-sensitive, so a second run on the same day (new items arrive, a different item
// becomes lead) produced a different topic_key for the same story — which defeated the
// `fetchPublishedTopicKeys` dedupe and republished the same news.
//
// The key is now a function of the cluster's member set, not of which member ranks first:
// a lexicographically-sorted token union for readability plus a fingerprint over the
// sorted, normalized URL set for identity.
export function buildClusterTopicKey(items = []) {
  const list = (Array.isArray(items) ? items : []).filter(Boolean)
  if (list.length === 0) return 'daily-topic'

  const urls = [...new Set(list.map((item) => normalizeUrlForLookup(item?.url || '')).filter(Boolean))].sort()
  const tokens = pickReadableSignatureTokens(
    [...new Set(list.flatMap((item) => buildTokenSignature(item)))].sort(),
    6,
  )
  const readable = slugify(tokens.join('-'), '') || slugify(stripMarkupForTokens(list[0]?.title || ''), 'daily-topic')

  if (urls.length === 0) return (readable || 'daily-topic').slice(0, 80)
  const fingerprint = createHash('sha1').update(urls.join('\n')).digest('hex').slice(0, 8)
  return `${readable ? `${readable.slice(0, 60)}-` : ''}${fingerprint}`.slice(0, 80)
}

export const AUTO_BLOG_CLI_HELP = [
  'Usage: node auto-blog.mjs [--mode daily-auto|daily-manual|weekly-review] [options]',
  '',
  '  --mode <mode>           Pipeline mode (default: config.default_mode).',
  '  --max-posts <n>         Cap the number of posts this run may publish.',
  '  --coverage-date <date>  YYYY-MM-DD coverage date (default: today).',
  '  --force                 Ignore already-published slug/topic-key guards.',
  '  --dry-run               Do not publish, upload images, write metadata bridges,',
  '                          trigger the Vercel deploy hook, or generate covers.',
  '  --help                  Show this message.',
  '',
  'COST WARNING: --dry-run is NOT free and NOT side-effect free. It still logs in to the',
  'admin API and still calls POST /api/admin/ai-text/generate for the outline, every body',
  'section, and every repair pass. Each of those inserts a row in admin_text_generation_jobs',
  'and bills the upstream model. A daily --dry-run --max-posts 1 costs roughly 1 login plus',
  '5-10 billed LLM jobs. What a dry run does NOT do: publish or update a post, upload or',
  'generate images, write publishing-status/quality/topic metadata, or refresh the frontend.',
].join('\n')

export function parseCliArgs(argv = process.argv.slice(2)) {
  const options = { dryRun: false, mode: null, maxPosts: null, coverageDate: null, force: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--dry-run') options.dryRun = true
    else if (current === '--help' || current === '-h') options.help = true
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

function resolveSeriesRulesPath(rawConfig = {}) {
  const configuredPath = rawConfig?.series_assignment?.rules_path || process.env.AUTO_BLOG_SERIES_RULES_PATH || ''
  if (!configuredPath) return DEFAULT_SERIES_RULES_PATH
  if (isAbsolute(configuredPath)) return configuredPath
  return resolve(dirname(CONFIG_PATH), configuredPath)
}

function resolveTopicPresentationRulesPath(rawConfig = {}) {
  const configuredPath = rawConfig?.topic_presentation?.rules_path || process.env.AUTO_BLOG_TOPIC_PRESENTATION_RULES_PATH || ''
  if (!configuredPath) return DEFAULT_TOPIC_PRESENTATION_RULES_PATH
  if (isAbsolute(configuredPath)) return configuredPath
  return resolve(dirname(CONFIG_PATH), configuredPath)
}

function normalizeSeriesAssignmentConfig(rawConfig = {}, rulesConfig = {}) {
  const root = rawConfig?.series_assignment || {}
  const rules = Array.isArray(rulesConfig?.rules) ? rulesConfig.rules : []
  const normalizedRules = rules
    .map((rule) => ({
      series_slug: String(rule?.series_slug || '').trim(),
      content_types: Array.isArray(rule?.content_types) ? rule.content_types.map((item) => String(item || '').trim()).filter(Boolean) : [],
      topic_key_prefixes: Array.isArray(rule?.topic_key_prefixes) ? rule.topic_key_prefixes.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [],
      keyword_match: Array.isArray(rule?.keyword_match) ? rule.keyword_match.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [],
      tag_match: Array.isArray(rule?.tag_match) ? rule.tag_match.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [],
      default_order: Number.isFinite(Number(rule?.default_order)) ? Number(rule.default_order) : null,
      priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : 0,
    }))
    .filter((rule) => rule.series_slug)
    .sort((left, right) => right.priority - left.priority)

  return {
    enabled: Boolean(root.enabled ?? true),
    default_series_slug: String(root.default_series_slug || rulesConfig?.default_series_slug || '').trim(),
    rules: normalizedRules,
    source_path: resolveSeriesRulesPath(rawConfig),
  }
}

async function loadSeriesAssignmentConfig(rawConfig = {}) {
  const rulesPath = resolveSeriesRulesPath(rawConfig)
  try {
    const raw = await readFile(rulesPath, 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeSeriesAssignmentConfig(rawConfig, parsed)
  } catch {
    return normalizeSeriesAssignmentConfig(rawConfig, {})
  }
}

function normalizeTopicPresentationConfig(rawConfig = {}, rulesConfig = {}) {
  const root = rawConfig?.topic_presentation || {}
  const rules = Array.isArray(rulesConfig?.rules) ? rulesConfig.rules : []
  const normalizedRules = rules
    .map((rule) => ({
      topic_key_exact: Array.isArray(rule?.topic_key_exact)
        ? rule.topic_key_exact.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [],
      topic_key_prefixes: Array.isArray(rule?.topic_key_prefixes)
        ? rule.topic_key_prefixes.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [],
      keyword_match: Array.isArray(rule?.keyword_match)
        ? rule.keyword_match.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
        : [],
      presentation: {
        zh_title: String(rule?.presentation?.zh_title || '').trim(),
        zh_subtitle: String(rule?.presentation?.zh_subtitle || '').trim(),
        zh_description: String(rule?.presentation?.zh_description || '').trim(),
        zh_tags: Array.isArray(rule?.presentation?.zh_tags)
          ? rule.presentation.zh_tags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
          : [],
      },
      topic_family: String(rule?.topic_family || '').trim(),
      priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : 0,
    }))
    .filter((rule) => (
      rule.topic_key_exact.length > 0
      || rule.topic_key_prefixes.length > 0
      || rule.keyword_match.length > 0
    ))
    .sort((left, right) => right.priority - left.priority)

  return {
    enabled: Boolean(root.enabled ?? true),
    rules: normalizedRules,
    default_presentation: {
      zh_title_template: String(root?.default_presentation?.zh_title_template || '').trim(),
      zh_subtitle_template: String(root?.default_presentation?.zh_subtitle_template || '').trim(),
      zh_description_template: String(root?.default_presentation?.zh_description_template || '').trim(),
      zh_tags: Array.isArray(root?.default_presentation?.zh_tags)
        ? root.default_presentation.zh_tags.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
    },
    source_path: resolveTopicPresentationRulesPath(rawConfig),
  }
}

async function loadTopicPresentationConfig(rawConfig = {}) {
  const rulesPath = resolveTopicPresentationRulesPath(rawConfig)
  try {
    const raw = await readFile(rulesPath, 'utf8')
    const parsed = JSON.parse(raw)
    return normalizeTopicPresentationConfig(rawConfig, parsed)
  } catch {
    return normalizeTopicPresentationConfig(rawConfig, {})
  }
}

function stripMarkdownForMetrics(contentMd) {
  return String(contentMd || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[>*_\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function estimateReadingTimeMinutes(contentMd) {
  const plain = stripMarkdownForMetrics(contentMd)
  const cjkChars = (plain.match(/[\u4e00-\u9fff]/g) || []).length
  const latinWords = (plain.match(/[A-Za-z0-9]+/g) || []).length
  const minutesByCjk = cjkChars / 320
  const minutesByLatin = latinWords / 220
  return Math.max(1, Math.round(Math.max(minutesByCjk + minutesByLatin, 0.2)))
}

export function computeQualityScore({ gate, gateProfile }) {
  const metrics = gate?.metrics || {}
  const minSources = Math.max(1, Number(gateProfile?.min_sources || 1))
  const minHighQualitySources = Math.max(1, Number(gateProfile?.min_high_quality_sources || 1))
  const minChars = Math.max(1, Number(gateProfile?.min_chars || 1))
  const minAnalysisSignals = Math.max(1, Number(gateProfile?.min_analysis_signals || 1))
  const maxBannedHits = Math.max(1, Number(gateProfile?.max_banned_phrase_hits ?? 0) + 1)

  const sourceRatio = Math.min(1, Number(metrics.source_count || 0) / minSources)
  const highQualityRatio = Math.min(1, Number(metrics.high_quality_source_count || 0) / minHighQualitySources)
  const charsRatio = Math.min(1, Number(metrics.char_count || 0) / minChars)
  const analysisRatio = Math.min(1, Number(metrics.analysis_signal_count || 0) / minAnalysisSignals)
  // The pipeline rewrites banned phrases before the gate runs, so `banned_phrase_hits` is
  // always 0 and this 10%-weight term was a constant that inflated every score. Prefer the
  // pre-rewrite count when the gate reported one.
  const bannedRatio = 1 - Math.min(1, Number(metrics.raw_banned_phrase_hits ?? metrics.banned_phrase_hits ?? 0) / maxBannedHits)
  const structureRatio = Array.isArray(metrics.missing_sections) && metrics.missing_sections.length > 0 ? 0 : 1

  const weighted = sourceRatio * 0.16
    + highQualityRatio * 0.16
    + charsRatio * 0.28
    + analysisRatio * 0.22
    + bannedRatio * 0.1
    + structureRatio * 0.08

  return Math.max(0, Math.min(100, Math.round(weighted * 100)))
}

function matchesRuleValues(values, haystack) {
  if (!Array.isArray(values) || values.length === 0) return true
  const normalizedHaystack = String(haystack || '').toLowerCase()
  return values.some((value) => normalizedHaystack.includes(String(value).toLowerCase()))
}

function matchesRuleTags(ruleTags, tags) {
  if (!Array.isArray(ruleTags) || ruleTags.length === 0) return true
  const tagSet = new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag || '').toLowerCase()))
  return ruleTags.some((tag) => tagSet.has(String(tag).toLowerCase()))
}

export function assignSeriesForPost({ post, outline, metadata, seriesAssignment }) {
  const config = seriesAssignment || {}
  if (!config.enabled) {
    return { series_slug: null, series_order: null, matched_rule: null }
  }

  const explicitSeriesSlug = String(metadata?.series_slug || post?.series_slug || '').trim()
  if (explicitSeriesSlug) {
    const explicitOrder = Number(metadata?.series_order ?? post?.series_order)
    return {
      series_slug: explicitSeriesSlug,
      series_order: Number.isFinite(explicitOrder) ? explicitOrder : null,
      matched_rule: 'manual_override',
    }
  }

  const contentType = String(metadata?.content_type || post?.content_type || '').trim()
  const topicKey = String(metadata?.topic_key || post?.topic_key || '').toLowerCase()
  const textHaystack = [
    post?.title || '',
    post?.summary || '',
    outline?.topic || '',
    outline?.thesis || '',
    topicKey,
  ].join(' ').toLowerCase()
  const tags = Array.isArray(post?.tags) ? post.tags : []

  const matchedRule = (Array.isArray(config.rules) ? config.rules : []).find((rule) => {
    if (rule.content_types?.length > 0 && !rule.content_types.includes(contentType)) return false
    if (rule.topic_key_prefixes?.length > 0 && !rule.topic_key_prefixes.some((prefix) => topicKey.startsWith(prefix))) return false
    if (!matchesRuleValues(rule.keyword_match, textHaystack)) return false
    if (!matchesRuleTags(rule.tag_match, tags)) return false
    return true
  })

  if (matchedRule) {
    return {
      series_slug: matchedRule.series_slug,
      series_order: Number.isFinite(Number(matchedRule.default_order)) ? Number(matchedRule.default_order) : null,
      matched_rule: matchedRule.series_slug,
    }
  }

  const fallbackSlug = String(config.default_series_slug || '').trim()
  return {
    series_slug: fallbackSlug || null,
    series_order: null,
    matched_rule: fallbackSlug ? 'default' : null,
  }
}

export function buildPostSourcesPayload({ researchPack, outline }) {
  const matcher = buildPrimarySourceMatcher(outline?.key_sources)
  const seen = new Set()
  const results = []

  for (const source of researchPack?.sources || []) {
    const sourceUrl = String(source?.url || '').trim()
    if (!sourceUrl || seen.has(sourceUrl)) continue
    seen.add(sourceUrl)

    results.push({
      source_type: String(source?.source_type || '').trim() || 'rss',
      source_name: String(source?.source_name || '').trim() || 'unknown',
      source_url: sourceUrl,
      published_at: normalizePublishedAt(source?.published_at),
      is_primary: Boolean(matcher.matches(source)),
    })
  }

  return results
}

export function buildPublishingArtifactPayload({
  post,
  outline,
  metadata,
  gate,
  researchPack,
  imagePlans,
  imageCoverage = null,
  workflowKey,
  coverageDate,
  candidateTopics = [],
  failureReason = '',
}) {
  const plans = Array.isArray(imagePlans) ? imagePlans : []
  return {
    workflow_key: String(workflowKey || '').trim(),
    coverage_date: String(coverageDate || metadata?.coverage_date || '').trim(),
    research_pack_summary: JSON.stringify({
      summary: String(researchPack?.summary || ''),
      source_count: Number(researchPack?.sources?.length || 0),
      blog_count: Number(researchPack?.blog_items?.length || 0),
      paper_count: Number(researchPack?.paper_items?.length || 0),
      topic: String(outline?.topic || ''),
      thesis: String(outline?.thesis || ''),
      cover_brief: String(outline?.cover_brief || '').trim(),
      cover_prompt: String(outline?.cover_prompt || '').trim(),
    }),
    quality_gate_json: JSON.stringify(gate || {}),
    // Stays a bare plan array when no coverage report was produced, so every existing reader
    // (and repair-post-media, which writes '[]') keeps working. When a report exists the
    // payload becomes { plans, coverage }: the plans alone cannot answer "why does this post
    // have no images", which is the only question anyone ever asks of this column.
    image_plan_json: JSON.stringify(imageCoverage ? { plans, coverage: imageCoverage } : plans),
    candidate_topics_json: JSON.stringify(Array.isArray(candidateTopics) ? candidateTopics : []),
    failure_reason: String(failureReason || '').trim(),
    post_slug: String(post?.slug || '').trim(),
  }
}

export function buildPublishingMetadataBridgePayload({
  postId,
  post,
  outline,
  metadata,
  gate,
  config,
  researchPack,
  imagePlans,
  imageCoverage = null,
  workflowKey,
  coverageDate,
  candidateTopics = [],
  failureReason = '',
}) {
  const gateProfile = resolveGateProfile(config, metadata?.content_type || post?.content_type || '')
  const qualityScore = computeQualityScore({ gate, gateProfile })
  const readingTime = estimateReadingTimeMinutes(post?.content_md || '')
  const seriesDecision = assignSeriesForPost({
    post,
    outline,
    metadata,
    seriesAssignment: config?.series_assignment || {},
  })
  const postSources = buildPostSourcesPayload({ researchPack, outline })
  const publishingArtifact = buildPublishingArtifactPayload({
    post,
    outline,
    metadata,
    gate,
    researchPack,
    imagePlans,
    imageCoverage,
    workflowKey,
    coverageDate,
    candidateTopics,
    failureReason,
  })

  return {
    post_id: Number.isFinite(Number(postId)) ? Number(postId) : null,
    post_slug: String(post?.slug || '').trim(),
    metadata: {
      series_slug: seriesDecision.series_slug,
      series_order: seriesDecision.series_order,
      source_count: postSources.length,
      quality_score: qualityScore,
      reading_time: readingTime,
    },
    post_sources: postSources,
    publishing_artifact: publishingArtifact,
  }
}

function clampScore(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.min(100, Math.round(numeric)))
}

function safeRatio(numerator, denominator) {
  const den = Number(denominator)
  if (!Number.isFinite(den) || den <= 0) return 0
  const num = Number(numerator)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.max(0, Math.min(1, num / den))
}

function buildQualitySignals({ metrics, sourceCount, post, seriesSlug }) {
  const issues = []
  const strengths = []
  const missingSections = Array.isArray(metrics?.missing_sections) ? metrics.missing_sections : []
  const analysisSignals = Number(metrics?.analysis_signal_count || 0)
  const bannedHits = Number(metrics?.banned_phrase_hits || 0)
  const readingTime = estimateReadingTimeMinutes(post?.content_md || '')
  const titleLength = String(post?.title || '').trim().length
  const summaryLength = String(post?.summary || '').trim().length

  if (sourceCount < 3) issues.push('missing_sources')
  if (missingSections.length > 0) issues.push('missing_sections')
  if (analysisSignals < 2) issues.push('analysis_thin')
  if (bannedHits > 0) issues.push('banned_phrase_hit')
  if (titleLength < 16) issues.push('weak_title')
  if (summaryLength < 18) issues.push('weak_summary')
  if (readingTime < 3) issues.push('too_short_for_depth')
  if (!seriesSlug) issues.push('series_unassigned')

  if (sourceCount >= 5) strengths.push('strong_source_mix')
  if (missingSections.length === 0) strengths.push('complete_structure')
  if (analysisSignals >= 4) strengths.push('analysis_depth_good')
  if (titleLength >= 22) strengths.push('title_clarity_good')
  if (readingTime >= 6) strengths.push('sufficient_depth')

  return { issues, strengths }
}

export function buildQualitySnapshotPayload({
  postId,
  post,
  outline,
  metadata,
  gate,
  config,
  researchPack,
}) {
  const metrics = gate?.metrics || {}
  const gateProfile = resolveGateProfile(config, metadata?.content_type || post?.content_type || '')
  const sourceCount = Number(metrics.source_count || researchPack?.sources?.length || 0)
  const highQualitySourceCount = Number(metrics.high_quality_source_count || 0)
  const analysisSignals = Number(metrics.analysis_signal_count || 0)
  const bannedHits = Number(metrics.raw_banned_phrase_hits ?? metrics.banned_phrase_hits ?? 0)
  const missingSections = Array.isArray(metrics.missing_sections) ? metrics.missing_sections : []
  const readingTime = estimateReadingTimeMinutes(post?.content_md || '')
  const seriesDecision = assignSeriesForPost({
    post,
    outline,
    metadata,
    seriesAssignment: config?.series_assignment || {},
  })

  const minSources = Math.max(1, Number(gateProfile?.min_sources || 1))
  const minHighQualitySources = Math.max(1, Number(gateProfile?.min_high_quality_sources || 1))
  const minAnalysisSignals = Math.max(1, Number(gateProfile?.min_analysis_signals || 1))
  const maxBannedHits = Math.max(1, Number(gateProfile?.max_banned_phrase_hits ?? 0) + 1)

  const structureScore = clampScore(missingSections.length === 0 ? 100 : Math.max(0, 100 - missingSections.length * 25))
  const sourceScore = clampScore(
    (safeRatio(sourceCount, minSources) * 60 + safeRatio(highQualitySourceCount, minHighQualitySources) * 40) * 100 / 100
  )
  const analysisScore = clampScore(
    (safeRatio(analysisSignals, minAnalysisSignals) * 70 + (1 - Math.min(1, bannedHits / maxBannedHits)) * 30) * 100 / 100
  )

  const hasCoverImage = String(post?.cover_image || '').trim().length > 0
  const titleLength = String(post?.title || '').trim().length
  const summaryLength = String(post?.summary || '').trim().length
  const packagingScore = clampScore(
    (Math.min(1, titleLength / 22) * 35
      + Math.min(1, summaryLength / 40) * 25
      + Math.min(1, readingTime / 8) * 25
      + (seriesDecision.series_slug ? 10 : 0)
      + (hasCoverImage ? 5 : 0))
  )

  const viewCount = Math.max(0, Number(post?.view_count || 0))
  const likeCount = Math.max(0, Number(post?.like_count || 0))
  const resonanceScore = clampScore(Math.min(100, viewCount * 0.25 + likeCount * 4))
  const qualityScore = computeQualityScore({ gate, gateProfile })
  const overallScore = clampScore(
    qualityScore * 0.45
    + structureScore * 0.2
    + sourceScore * 0.15
    + analysisScore * 0.15
    + packagingScore * 0.05
  )
  const signals = buildQualitySignals({
    metrics,
    sourceCount,
    post,
    seriesSlug: seriesDecision.series_slug,
  })

  return {
    post_id: Number.isFinite(Number(postId)) ? Number(postId) : null,
    post_slug: String(post?.slug || '').trim(),
    quality_snapshot: {
      content_type: String(metadata?.content_type || post?.content_type || '').trim(),
      topic_key: String(metadata?.topic_key || post?.topic_key || '').trim(),
      coverage_date: String(metadata?.coverage_date || post?.coverage_date || '').trim(),
      overall_score: overallScore,
      structure_score: structureScore,
      source_score: sourceScore,
      analysis_score: analysisScore,
      packaging_score: packagingScore,
      resonance_score: resonanceScore,
      quality_score: qualityScore,
      source_count: sourceCount,
      high_quality_source_count: highQualitySourceCount,
      reading_time: readingTime,
      issues: signals.issues,
      strengths: signals.strengths,
      notes: gate?.passed
        ? 'Quality snapshot generated after a passed gate.'
        : 'Quality snapshot generated in degraded mode.',
      generated_at: new Date().toISOString(),
    },
  }
}

function inferTopicFamily(topicKey = '') {
  const normalized = String(topicKey || '').toLowerCase()
  if (!normalized) return 'general'
  if (normalized.includes('agent')) return 'agent'
  if (normalized.includes('model')) return 'model'
  if (normalized.includes('open-source') || normalized.includes('opensource')) return 'open_source'
  if (normalized.includes('inference') || normalized.includes('deployment')) return 'infrastructure'
  return 'general'
}

function renderTemplate(template, context = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => String(context[key] || '').trim()).trim()
}

function hasCJK(value = '') {
  return /[\u3400-\u9FFF]/.test(String(value || ''))
}

function toReadableTopicKey(topicKey = '') {
  return String(topicKey || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildChineseTopicFallback({ topicKey, outline, post, metadata }) {
  const topicFromOutline = String(outline?.topic || '').trim()
  if (hasCJK(topicFromOutline)) return topicFromOutline

  const titleFromPost = String(post?.title || '').trim()
  if (hasCJK(titleFromPost)) return titleFromPost

  const keyLabel = toReadableTopicKey(topicKey)
  const familyLabel = String(inferTopicFamily(topicKey) || 'general')
  const familyZhMap = {
    weekly_review: '周报主线',
    agent: '智能体',
    model: '模型',
    open_source: '开源生态',
    infrastructure: '基础设施',
    general: '主题',
  }
  const familyZh = familyZhMap[familyLabel] || familyZhMap.general
  if (!keyLabel) return `AI${familyZh}追踪`

  const contentType = String(metadata?.content_type || post?.content_type || '').trim()
  if (contentType === 'weekly_review') return `AI周报：${keyLabel}`
  if (contentType === 'daily_brief') return `AI日报：${keyLabel}`
  return `AI${familyZh}追踪：${keyLabel}`
}

function buildTopicTextHaystack({ topicKey, outline, post, metadata }) {
  return [
    String(topicKey || ''),
    String(outline?.topic || ''),
    String(outline?.thesis || ''),
    String(post?.title || ''),
    String(post?.summary || ''),
    String(metadata?.content_type || ''),
  ].join(' ').toLowerCase()
}

function matchTopicPresentationRule({ topicKey, haystack, config }) {
  if (!config?.enabled) return null
  const key = String(topicKey || '').toLowerCase()
  return (config?.rules || []).find((rule) => {
    if (rule.topic_key_exact.length > 0 && rule.topic_key_exact.includes(key)) return true
    if (rule.topic_key_prefixes.length > 0 && rule.topic_key_prefixes.some((prefix) => key.startsWith(prefix))) return true
    if (rule.keyword_match.length > 0 && rule.keyword_match.some((keyword) => haystack.includes(keyword))) return true
    return false
  }) || null
}

export function buildTopicPresentation({ topicKey, outline, post, metadata, topicPresentationConfig }) {
  const key = String(topicKey || '').trim()
  const haystack = buildTopicTextHaystack({ topicKey: key, outline, post, metadata })
  const matchedRule = matchTopicPresentationRule({ topicKey: key, haystack, config: topicPresentationConfig || {} })
  const context = {
    topic_key: key,
    topic: String(outline?.topic || post?.title || '').trim(),
    thesis: String(outline?.thesis || post?.summary || '').trim(),
    content_type: String(metadata?.content_type || post?.content_type || '').trim(),
  }
  const fallback = topicPresentationConfig?.default_presentation || {}
  const renderedFallbackTitle = renderTemplate(fallback.zh_title_template, context)
  const renderedFallbackSubtitle = renderTemplate(fallback.zh_subtitle_template, context)
  const zhTitle = matchedRule?.presentation?.zh_title
    || (hasCJK(renderedFallbackTitle) ? renderedFallbackTitle : '')
    || buildChineseTopicFallback({ topicKey: key, outline, post, metadata })
  const zhSubtitle = matchedRule?.presentation?.zh_subtitle
    || (hasCJK(renderedFallbackSubtitle) ? renderedFallbackSubtitle : '')
    || (hasCJK(context.thesis) ? context.thesis : '')
  const zhDescription = matchedRule?.presentation?.zh_description || renderTemplate(fallback.zh_description_template, context)
  const zhTags = matchedRule?.presentation?.zh_tags?.length > 0
    ? matchedRule.presentation.zh_tags
    : (Array.isArray(fallback.zh_tags) ? fallback.zh_tags : [])

  return {
    zh_title: String(zhTitle || '').trim(),
    zh_subtitle: String(zhSubtitle || '').trim(),
    zh_description: String(zhDescription || '').trim(),
    zh_tags: zhTags.slice(0, 8),
    matched_rule: matchedRule ? {
      priority: matchedRule.priority,
      topic_family: matchedRule.topic_family || '',
    } : null,
  }
}

export function buildTopicMetadataPayload({
  postId,
  post,
  outline,
  metadata,
  gate,
  researchPack,
  config = {},
}) {
  const metrics = gate?.metrics || {}
  const topicKey = String(metadata?.topic_key || post?.topic_key || '').trim()
  const coverageDate = String(metadata?.coverage_date || post?.coverage_date || '').trim()
  const sourceCount = Number(metrics?.source_count || researchPack?.sources?.length || 0)
  const highQualitySourceCount = Number(metrics?.high_quality_source_count || 0)
  const analysisSignalCount = Number(metrics?.analysis_signal_count || 0)
  const readingTime = estimateReadingTimeMinutes(post?.content_md || '')
  const freshnessWindow = String(coverageDate || '').trim()
  const sourceNames = [...new Set((researchPack?.sources || []).map((item) => String(item?.source_name || '').trim()).filter(Boolean))]
  const presentation = buildTopicPresentation({
    topicKey,
    outline,
    post,
    metadata,
    topicPresentationConfig: config?.topic_presentation || {},
  })
  const bridgeTopicTitle = String(presentation.zh_title || '').trim()
    || buildChineseTopicFallback({ topicKey, outline, post, metadata })
    || String(outline?.topic || post?.title || '').trim()
    || topicKey

  return {
    post_id: Number.isFinite(Number(postId)) ? Number(postId) : null,
    post_slug: String(post?.slug || '').trim(),
    topic_key: topicKey,
    topic_metadata: {
      topic_key: topicKey,
      topic_family: inferTopicFamily(topicKey),
      content_type: String(metadata?.content_type || post?.content_type || '').trim(),
      coverage_date: coverageDate,
      source_count: sourceCount,
      high_quality_source_count: highQualitySourceCount,
      analysis_signal_count: analysisSignalCount,
      reading_time: readingTime,
      source_names: sourceNames.slice(0, 10),
      primary_thesis: String(outline?.thesis || '').trim(),
      topic_title: bridgeTopicTitle,
      topic_zh_title: presentation.zh_title,
      topic_zh_subtitle: presentation.zh_subtitle,
      topic_zh_description: presentation.zh_description,
      topic_zh_tags: presentation.zh_tags,
      gate_passed: Boolean(gate?.passed),
      notes: gate?.passed
        ? 'Topic metadata captured from post-publish artifact.'
        : 'Topic metadata captured in degraded mode.',
      generated_at: new Date().toISOString(),
      snapshot_version: 'topic_metadata_v1',
      freshness_window: freshnessWindow,
      topic_cover_image: String(post?.topic_cover_image || '').trim(),
      presentation_rule: presentation.matched_rule,
    },
  }
}

async function loadConfig() {
  const raw = await readFile(CONFIG_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  parsed.series_assignment = await loadSeriesAssignmentConfig(parsed)
  parsed.topic_presentation = await loadTopicPresentationConfig(parsed)
  return parsed
}

async function fetchBaseFeed(feed) {
  const resp = await fetch(feed.url, {
    headers: {
      'User-Agent': 'AutoBlogBot/3.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    // 静默 return [] 是这次事故能潜伏这么久的原因之一：4 个源 404 了半年没人发现。
    console.warn(`Feed ${feed.name || feed.url} returned HTTP ${resp.status}; skipped.`)
    return []
  }
  const xml = await readResponseTextCapped(resp)
  return parseFeedXml(xml, {
    name: feed.name || feed.tag,
    source_type: feed.source_type || 'rss',
    lang: feed.lang,
    quality_weight: Number(feed.quality_weight || 0.45),
    channel_bucket: feed.channel_bucket,
    source_group: feed.source_group || feed.name || feed.tag,
    tag: feed.tag,
  })
}

async function fetchAllFeeds(config, maxItems = 30) {
  console.log(`Fetching ${config.rss_feeds.length} base feeds...`)
  // Bounded concurrency: ~30 simultaneous feed fetches tripped rate limits and made the
  // whole batch share one 15s timeout budget.
  const settled = await mapWithConcurrency(config.rss_feeds || [], (feed) => fetchBaseFeed(feed), 6)
  // `.filter(fulfilled)` 单独用是个哑失败：fast-xml-parser 的实体展开上限让 AWS ML /
  // MIT News / Simon Willison / GitHub Trending 四个源连续抛异常，共 118 条素材凭空消失，
  // 而日志里一个字都没有。素材供给是这条流水线唯一的输入，它少了必须喊出来。
  const failures = []
  settled.forEach((result, index) => {
    const feed = (config.rss_feeds || [])[index]
    if (result.status === 'rejected') {
      failures.push(`${feed?.name || feed?.url}: ${result.reason?.message || result.reason}`)
    } else if ((result.value || []).length === 0) {
      failures.push(`${feed?.name || feed?.url}: 0 items`)
    }
  })
  if (failures.length > 0) {
    console.warn(`Feed collection: ${settled.length - failures.length}/${settled.length} sources produced items. Unproductive: ${failures.join(' | ')}`)
  }
  const items = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
  const sourceDiversity = resolveSourceDiversityConfig(config)
  return applySourceDiversity(dedupeResearchItems(items), {
    enabled: sourceDiversity.enabled,
    preferredBucketOrder: sourceDiversity.preferredBucketOrder,
    perSourceCap: sourceDiversity.candidateCapPerSource,
    maxItems,
    rankItem: (item) => Number(item?.score || 0),
  })
}

// Returns both halves of one jina fetch: the prompt text and the illustrations that were
// riding along in it. The markdown Jina hands back contains every in-article image as
// `![](…)`, and the pipeline used to keep only the prose — so the picker's *only* supply was
// "go re-fetch the source page HTML ourselves", which JS-rendered bodies, paywalls and bot
// walls kill on a large share of sources. That supply shortage is half of why coverage is low.
//
// The image harvest deliberately runs on the FULL response body, before `maxLen` truncation:
// `maxLen` exists to bound the LLM prompt, and applying it first silently discarded every
// illustration in the second half of a long article — which is exactly where explanatory
// diagrams live. The text half is still truncated as before, so prompt size is unchanged.
//
// `url` (the original article URL, not the r.jina.ai proxy URL) is the resolution base, so a
// relative link cannot produce a candidate pointing at r.jina.ai.
export async function jinaReadDocument(url, maxLen = 5000, { fetchImpl = fetch } = {}) {
  const empty = { text: '', mediaCandidates: [] }
  try {
    // The URL comes from third-party feed content; refuse private/loopback/non-http
    // targets before handing it to the jina proxy, and encode it so it can't break
    // out of the proxy path.
    if (!isPublicHttpUrl(url)) return empty
    const resp = await fetchImpl(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      headers: { Accept: 'text/markdown', 'X-No-Cache': 'true' },
      signal: AbortSignal.timeout(20000),
      redirect: 'manual',
    })
    if (!resp.ok) return empty
    const text = await resp.text()
    return {
      text: text.slice(0, maxLen),
      // Same extractor the feed half uses, so both image sources produce one candidate shape
      // and stay subject to the same tracking-pixel / SSRF filtering.
      mediaCandidates: extractMarkdownImageCandidates(text, url),
    }
  } catch {
    return empty
  }
}

// The text-only `jinaRead` wrapper this replaced is deliberately gone rather than kept for
// convenience: it discarded the image candidates from the same response, and a helper whose
// only effect is to silently drop the supply this change exists to create is a trap.
// Every caller uses jinaReadDocument and takes `.text` explicitly.

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
        jinaReadDocument(current.url, 6000)
          .then(({ text, mediaCandidates }) => {
            if (text.length > 100) {
              current.full_text = removeBoilerplate(text)
              current.evidence_snippets = [trimText(current.full_text, 180)]
              current.score = Number((current.score + 0.08).toFixed(3))
            }
            // Merged with whatever the feed already carried rather than replacing it: the two
            // sources describe the same picture with different detail (feed markup has the
            // figcaption, jina has the surrounding prose). Kept even when the text was too
            // thin to use — a gallery page still has usable illustrations, and this costs no
            // extra request.
            if (mediaCandidates.length > 0) {
              current.media_candidates = mergeMediaCandidates(current.media_candidates, mediaCandidates)
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

function buildCoverageWindowEnd(coverageDate) {
  if (!coverageDate) return Date.now()
  const end = Date.parse(`${coverageDate}T23:59:59Z`)
  return Number.isFinite(end) ? end : Date.now()
}

export function filterItemsForCoverageWindow(
  items,
  { coverageDate = '', lookbackHours = 0, lookbackDays = 0, minItems = 0 } = {},
) {
  return filterResearchItemsByPublishedWindow(items, {
    coverageDate,
    lookbackHours,
    lookbackDays,
    minItems,
    rankItem: itemRelevanceScore,
  })
}

async function collectBaseMaterials(config, options = {}) {
  const {
    feedLimit = 30,
    enrichLimit = 15,
    maxReturnItems = 30,
    coverageDate = '',
    lookbackHours = 0,
    lookbackDays = 0,
    fallbackMinText = 300,
  } = options
  const sourceDiversity = resolveSourceDiversityConfig(config)

  const feedItems = await fetchAllFeeds(config, feedLimit)
  const itemsWithLinks = feedItems.filter((item) => item.url)
  const enriched = await enrichWithFullText(itemsWithLinks.slice(0, enrichLimit))
  // Jina enrichment is an enhancement, not a filter. Previously `materials` was built from
  // the enriched subset alone, so anything past `enrichLimit` (hard-coded 15 for daily) was
  // silently discarded and `max_candidate_items` had no effect at all.
  const enrichedByFingerprint = new Map(enriched.map((item) => [sourceFingerprint(item), item]))

  let materials = dedupeResearchItems(
    itemsWithLinks.map((item) => enrichedByFingerprint.get(sourceFingerprint(item)) || item)
  )
  const combinedText = materials.map((item) => item.full_text || item.summary).join('\n')
  if (combinedText.length < fallbackMinText) {
    console.log('Base RSS materials are weak, using fallback pages...')
    for (const url of config.fallback_urls || []) {
      const { text: markdown, mediaCandidates } = await jinaReadDocument(url, 6000)
      if (markdown.length <= 200) continue
      materials.push({
        media_candidates: mediaCandidates,
        source_type: 'rss',
        source_name: 'Fallback',
        source_group: 'fallback',
        channel_bucket: 'global_media',
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

  const filtered = filterItemsForCoverageWindow(materials, {
    coverageDate,
    lookbackHours,
    lookbackDays,
    minItems: Math.min(10, Math.max(4, Math.floor(maxReturnItems / 2))),
  })

  return applySourceDiversity(dedupeResearchItems(filtered), {
    enabled: sourceDiversity.enabled,
    preferredBucketOrder: sourceDiversity.preferredBucketOrder,
    perSourceCap: sourceDiversity.candidateCapPerSource,
    maxItems: maxReturnItems,
    rankItem: itemRelevanceScore,
  })
}

function compactResearchItem(item) {
  const domain = item.domain || extractDomain(item.url)
  return {
    source_id: item.source_id || '',
    source_type: item.source_type,
    source_name: item.source_name,
    source_group: item.source_group,
    channel_bucket: item.channel_bucket,
    domain,
    title: item.title,
    url: item.url,
    published_at: item.published_at,
    lang: item.lang,
    summary: trimText(item.summary || item.full_text, 260),
    score: item.score,
    evidence_snippets: (item.evidence_snippets || []).slice(0, 3),
    is_primary: Boolean(item.is_primary),
  }
}

function buildEvidenceCard(item) {
  return {
    id: item.source_id,
    title: item.title,
    url: item.url,
    domain: item.domain || extractDomain(item.url),
    source_type: item.source_type,
    source_name: item.source_name,
    source_group: item.source_group,
    channel_bucket: item.channel_bucket,
    published_at: item.published_at,
    summary: trimText(item.summary || item.full_text, 360),
    evidence_snippets: (item.evidence_snippets || []).slice(0, 3),
    reliability_score: Number(item.score || 0),
    is_primary: Boolean(item.is_primary),
  }
}

function attachSourceIds(items = []) {
  const sources = dedupeResearchItems(items).map((item, index) => ({
    ...item,
    source_id: `S${index + 1}`,
    domain: item.domain || extractDomain(item.url),
  }))
  const byFingerprint = new Map(sources.map((item) => [sourceFingerprint(item), item.source_id]))
  const attach = (item) => ({
    ...item,
    source_id: byFingerprint.get(sourceFingerprint(item)) || '',
    domain: item.domain || extractDomain(item.url),
  })
  return { sources, attach }
}

function buildSourceStats(sources = []) {
  const uniqueDomains = [...new Set(sources.map((item) => item.domain || extractDomain(item.url)).filter(Boolean))]
  const sourceTypeCounts = sources.reduce((counts, item) => {
    const key = item.source_type || 'unknown'
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const sourceGroupCount = new Set(sources.map((item) => item.source_group || item.source_name).filter(Boolean)).size
  const bucketCount = new Set(sources.map((item) => item.channel_bucket).filter(Boolean)).size
  return {
    total_sources: sources.length,
    unique_domains: uniqueDomains.length,
    domains: uniqueDomains.slice(0, 20),
    source_type_counts: sourceTypeCounts,
    source_group_count: sourceGroupCount,
    bucket_count: bucketCount,
  }
}

function buildResearchPack({ baseItems, blogItems, paperItems }) {
  const { sources, attach } = attachSourceIds([
    ...(baseItems || []),
    ...(blogItems || []),
    ...(paperItems || []),
  ])
  const sourceStats = buildSourceStats(sources)

  return {
    summary: {
      base_count: baseItems.length,
      blogwatcher_count: blogItems.length,
      paper_count: paperItems.length,
      total_sources: sources.length,
      unique_domains: sourceStats.unique_domains,
    },
    source_stats: sourceStats,
    evidence_cards: sources.map(buildEvidenceCard),
    base_items: baseItems.map(attach).map(compactResearchItem),
    blog_items: blogItems.map(attach).map(compactResearchItem),
    paper_items: paperItems.map(attach).map(compactResearchItem),
    // `media_candidates` rides on `sources` only, deliberately outside compactResearchItem:
    // the digest builders re-run compactResearchItem over these same rows to build the LLM
    // prompt, so anything added here is dropped again before it can bloat or confuse the
    // prompt, while the image picker (which reads researchPack.sources directly) sees it.
    sources: sources.map((item) => {
      const compact = compactResearchItem(item)
      const media = Array.isArray(item.media_candidates) ? item.media_candidates : []
      return media.length > 0 ? { ...compact, media_candidates: media } : compact
    }),
  }
}

export function clusterResearchItemsByTopic(items, options = {}) {
  const similarityThreshold = options.similarityThreshold ?? 0.5
  const sorted = [...(items || []).filter((item) => item?.url)]
    .sort((left, right) => itemRelevanceScore(right) - itemRelevanceScore(left))
  const clusters = []

  for (const item of sorted) {
    const signature = buildTokenSignature(item)
    // 这条兜底原本是给「标题一字不差的转载」用的，但 slugify 会剥掉全部汉字，纯中文标题
    // 因此一律塌成 fallback 'topic'——而下面这条分支根本不看相似度。实测 14 天素材池里 7 条
    // 互不相关的中文稿（清洁机器人 / 车企测评 / 腾讯混元 / 有声角落 / 世界模型 / 湿度管理 /
    // 冰手冲）被强行并成同一个簇，两两真实相似度是 0；这个垃圾簇恰恰是全池唯一凑得齐
    // 3 源 3 域名的簇。所以 fallback 必须是空串，空串不参与匹配。
    const titleKey = slugify(item.title, '')
    let targetCluster = null

    for (const cluster of clusters) {
      const similarity = computeTopicSimilarity(signature, cluster.signature)
      if (similarity >= similarityThreshold || (titleKey && titleKey === cluster.title_key)) {
        targetCluster = cluster
        break
      }
    }

    if (!targetCluster) {
      targetCluster = { title_key: titleKey, signature, items: [] }
      clusters.push(targetCluster)
    }

    targetCluster.items.push(item)
    targetCluster.signature = [...new Set([...targetCluster.signature, ...signature])].slice(0, CLUSTER_SIGNATURE_LIMIT)
  }

  return clusters.map((cluster) => {
    const orderedItems = [...cluster.items].sort((left, right) => itemRelevanceScore(right) - itemRelevanceScore(left))
    const lead = orderedItems[0]
    const sources = new Set(orderedItems.map((item) => `${item.source_name}:${item.url}`))
    const sourceGroups = [...new Set(
      orderedItems.map((item) => String(item.source_group || item.source_name || '').trim()).filter(Boolean),
    )]
    const channelBuckets = [...new Set(
      orderedItems.map((item) => String(item.channel_bucket || '').trim()).filter(Boolean),
    )]
    const nonOfficialSourceCount = sourceGroups.filter((group) => {
      const sample = orderedItems.find((item) => String(item.source_group || item.source_name || '').trim() === group)
      return String(sample?.channel_bucket || '') !== 'official_vendor'
    }).length
    return {
      topic_key: buildClusterTopicKey(orderedItems),
      title_key: cluster.title_key,
      candidate_title: lead?.title || 'AI 主题',
      lead_source_name: lead?.source_name || '',
      latest_published_at: orderedItems.map((item) => item.published_at).sort((left, right) => scoreTimestamp(right) - scoreTimestamp(left))[0] || '',
      score: Number(orderedItems.reduce((total, item) => total + itemRelevanceScore(item), 0).toFixed(4)),
      source_count: sources.size,
      bucket_count: channelBuckets.length,
      non_official_source_count: nonOfficialSourceCount,
      source_groups: sourceGroups,
      // keywords 会被 runDailyArxivSupplement 直接拼成 arXiv 查询串，只有拉丁 token 有用。
      keywords: pickReadableSignatureTokens(cluster.signature, 8),
      items: orderedItems,
    }
  }).sort((left, right) => {
    if (right.source_count !== left.source_count) return right.source_count - left.source_count
    if (right.score !== left.score) return right.score - left.score
    return scoreTimestamp(right.latest_published_at) - scoreTimestamp(left.latest_published_at)
  })
}

const BRIEF_SLUG_PATTERN = /^ai-brief-(\d{4}-\d{2}-\d{2})-(.+)$/

// The old helper hard-coded the *current* coverage date into the prefix, so it returned ''
// for every slug stamped with another day — it could never contribute anything to a
// cross-day lookup. Parsing the date out instead makes the slug usable at any distance.
export function parseBriefSlug(slug) {
  const match = BRIEF_SLUG_PATTERN.exec(String(slug || '').trim())
  if (!match) return null
  return { coverage_date: match[1], topic_key: match[2] }
}

// Deliberately still coverage-date-scoped: this feeds the *same-day* exact-key guard, and a
// brief stamped with another day's date is another day's brief. Cross-day reruns are not
// caught here at all — a cluster key is a fingerprint over its member URLs, so it never
// repeats once the member set shifts. `findPublishedTopicOverlap` handles that case.
function inferTopicKeyFromSlug(slug, coverageDate) {
  const parsed = parseBriefSlug(slug)
  return parsed && parsed.coverage_date === coverageDate ? parsed.topic_key : ''
}

export async function fetchPublishedTopicKeys({ coverageDate, fetchImpl = fetch }) {
  const topicKeys = new Set()
  let page = 1
  const pageSize = 50

  while (page <= 4) {
    let response
    try {
      response = await fetchImpl(`${BLOG_API_BASE}/api/posts?page=${page}&page_size=${pageSize}`, {
        signal: AbortSignal.timeout(10000),
      })
    } catch {
      break
    }

    if (!response.ok) break
    const data = await response.json()
    const items = Array.isArray(data?.items) ? data.items : []
    for (const post of items) {
      if (String(post?.coverage_date || '').trim() !== coverageDate) continue
      const topicKey = post.topic_key || inferTopicKeyFromSlug(post.slug, coverageDate)
      if (topicKey) topicKeys.add(topicKey)
    }
    if (items.length < pageSize) break
    page += 1
  }

  return topicKeys
}

// --- Cross-day dedupe -------------------------------------------------------------------
//
// `buildClusterTopicKey` derives a cluster's identity from its member URL set, which is the
// right call for same-day stability but makes exact topic_key matching structurally unable
// to catch a rerun on a later day: the window slides, new coverage arrives, the member set
// changes, and the fingerprint changes with it. Widening the lookback of an exact-match
// lookup cannot fix that — it would still match zero rows.
//
// So cross-day reruns are judged on how much of the candidate cluster's source-URL set
// already appears in a recently published article. Those URLs are reachable: the public
// `GET /api/posts/{slug}` payload carries `sources[].source_url` (written by the publishing
// metadata bridge), with the article body's reference links as a fallback for posts whose
// bridge never landed.
export const CROSS_DAY_DEDUPE_DEFAULTS = {
  enabled: true,
  lookbackDays: 7,
  // Overlap coefficient, i.e. |A∩B| / min(|A|,|B|) — the same shape `computeTopicSimilarity`
  // already uses for token overlap. Jaccard is the wrong measure here: a day-2 cluster is
  // usually much larger than the day-1 article it duplicates (2 carried-over URLs out of 7
  // candidates vs 3 published sources scores 0.25 by Jaccard but 0.67 by overlap), so a
  // Jaccard threshold loose enough to catch it would also fire on unrelated topics.
  overlapThreshold: 0.5,
  // Guards the degenerate end of the overlap coefficient: when the smaller set holds a
  // single URL, any incidental hit scores a perfect 1.0. Two shared sources is the point
  // where "the same story" beats "both cited the same roundup".
  minSharedSources: 2,
  maxListPages: 4,
  listPageSize: 50,
  maxDetailFetches: 20,
  requestTimeoutMs: 10000,
}

function clampNumber(value, { fallback, min, max, integer = false }) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  const bounded = Math.min(max, Math.max(min, numeric))
  return integer ? Math.round(bounded) : bounded
}

export function resolveCrossDayDedupeConfig(config = {}, modeConfig = {}) {
  const root = { ...(config?.cross_day_dedupe || {}), ...(modeConfig?.cross_day_dedupe || {}) }
  const defaults = CROSS_DAY_DEDUPE_DEFAULTS
  return {
    enabled: Boolean(root.enabled ?? defaults.enabled),
    lookbackDays: clampNumber(root.lookback_days, { fallback: defaults.lookbackDays, min: 1, max: 60, integer: true }),
    overlapThreshold: clampNumber(root.overlap_threshold, { fallback: defaults.overlapThreshold, min: 0.05, max: 1 }),
    minSharedSources: clampNumber(root.min_shared_sources, { fallback: defaults.minSharedSources, min: 1, max: 20, integer: true }),
    maxListPages: clampNumber(root.max_list_pages, { fallback: defaults.maxListPages, min: 1, max: 10, integer: true }),
    // The public list endpoint caps page_size at 50; asking for more is a 422.
    listPageSize: clampNumber(root.list_page_size, { fallback: defaults.listPageSize, min: 1, max: 50, integer: true }),
    maxDetailFetches: clampNumber(root.max_detail_fetches, { fallback: defaults.maxDetailFetches, min: 0, max: 100, integer: true }),
    requestTimeoutMs: clampNumber(root.request_timeout_ms, { fallback: defaults.requestTimeoutMs, min: 1000, max: 60000, integer: true }),
  }
}

export function shiftCoverageDate(coverageDate, deltaDays) {
  const parsed = Date.parse(`${String(coverageDate || '').trim()}T00:00:00Z`)
  if (!Number.isFinite(parsed)) return String(coverageDate || '').trim()
  return new Date(parsed + Number(deltaDays || 0) * 86_400_000).toISOString().slice(0, 10)
}

// ISO dates sort lexicographically, so plain string comparison is enough.
function isCoverageDateInWindow(value, windowStart, windowEnd) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  return date >= windowStart && date <= windowEnd
}

const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/g
const IMAGE_URL_PATTERN = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(?:$|[?#])/i

// Fallback for published posts whose `post_sources` bridge failed: the rendered article
// still carries its 参考来源 links, and content_md rides along in the same detail response,
// so this costs no extra request.
export function extractReferenceUrlsFromMarkdown(markdown, { excludeHosts = [] } = {}) {
  const blocked = new Set(excludeHosts.map((host) => String(host || '').replace(/^www\./i, '').toLowerCase()).filter(Boolean))
  const body = String(markdown || '').replace(MARKDOWN_IMAGE_PATTERN, ' ')
  const urls = new Set()
  for (const match of body.matchAll(MARKDOWN_LINK_PATTERN)) {
    const raw = match[1].replace(/[).,;]+$/, '')
    if (IMAGE_URL_PATTERN.test(raw)) continue
    const host = extractDomain(raw)
    if (!host || blocked.has(host)) continue
    const normalized = normalizeUrlForLookup(raw)
    if (normalized) urls.add(normalized)
  }
  return urls
}

export function collectTopicSourceUrls(topic) {
  const items = Array.isArray(topic?.items) ? topic.items : []
  return new Set(items.map((item) => normalizeUrlForLookup(item?.url || item?.source_url || '')).filter(Boolean))
}

export function computeSourceOverlap(candidateUrls, publishedUrls) {
  const left = candidateUrls instanceof Set ? candidateUrls : new Set(candidateUrls || [])
  const right = publishedUrls instanceof Set ? publishedUrls : new Set(publishedUrls || [])
  if (left.size === 0 || right.size === 0) return { shared: 0, ratio: 0 }
  let shared = 0
  for (const url of left) {
    if (right.has(url)) shared += 1
  }
  return { shared, ratio: shared / Math.min(left.size, right.size) }
}

export function findPublishedTopicOverlap(topic, fingerprints = [], options = {}) {
  const overlapThreshold = Number.isFinite(Number(options.overlapThreshold))
    ? Number(options.overlapThreshold)
    : CROSS_DAY_DEDUPE_DEFAULTS.overlapThreshold
  const minSharedSources = Number.isFinite(Number(options.minSharedSources))
    ? Number(options.minSharedSources)
    : CROSS_DAY_DEDUPE_DEFAULTS.minSharedSources
  const candidateUrls = collectTopicSourceUrls(topic)
  if (candidateUrls.size === 0) return null

  let best = null
  for (const fingerprint of Array.isArray(fingerprints) ? fingerprints : []) {
    const { shared, ratio } = computeSourceOverlap(candidateUrls, fingerprint?.source_urls)
    if (shared < minSharedSources || ratio < overlapThreshold) continue
    if (!best || ratio > best.overlap_ratio) {
      best = {
        post_slug: String(fingerprint?.slug || ''),
        // Named `post_topic_key`, not `topic_key`: callers merge this into a record keyed by
        // the *candidate's* topic_key, and a bare `topic_key` here silently overwrote it.
        post_topic_key: String(fingerprint?.topic_key || ''),
        coverage_date: String(fingerprint?.coverage_date || ''),
        overlap_ratio: Number(ratio.toFixed(4)),
        shared_source_count: shared,
      }
    }
  }
  return best
}

async function fetchPublishedPostSourceUrls({ slug, blogApiBase, fetchImpl, requestTimeoutMs, logger, collectImageUrls = false }) {
  try {
    const response = await fetchImpl(`${blogApiBase}/api/posts/${encodeURIComponent(slug)}`, {
      // Identifying as a bot keeps `/api/posts/{slug}` from counting the dedupe scan as a
      // reader view — the backend excludes automated user agents from view_count.
      headers: { 'User-Agent': 'AutoBlogBot/3.0' },
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const detail = await response.json()
    const bridged = new Set(
      (Array.isArray(detail?.sources) ? detail.sources : [])
        .map((source) => normalizeUrlForLookup(source?.source_url || ''))
        .filter(Boolean),
    )
    const urls = bridged.size > 0
      ? bridged
      : extractReferenceUrlsFromMarkdown(detail?.content_md, { excludeHosts: [extractDomain(blogApiBase)] })
    // The inline illustrations live in the very same detail payload, so the cross-post
    // image guard rides along on this request instead of issuing a second round.
    const imageUrls = collectImageUrls ? extractInlineImageUrlsFromMarkdown(detail?.content_md) : []
    return { urls, imageUrls, ok: true }
  } catch (error) {
    logger?.warn?.(`Cross-day dedupe: could not read sources of published post "${slug}" (${error?.message || error}).`)
    return { urls: new Set(), imageUrls: [], ok: false }
  }
}

// Returns the same-day exact-key set (drop-in for `fetchPublishedTopicKeys`) plus a
// source-URL fingerprint per recently published post, from a single list pass.
export async function fetchRecentPublishedTopicFingerprints({
  coverageDate,
  lookbackDays = CROSS_DAY_DEDUPE_DEFAULTS.lookbackDays,
  maxListPages = CROSS_DAY_DEDUPE_DEFAULTS.maxListPages,
  listPageSize = CROSS_DAY_DEDUPE_DEFAULTS.listPageSize,
  maxDetailFetches = CROSS_DAY_DEDUPE_DEFAULTS.maxDetailFetches,
  requestTimeoutMs = CROSS_DAY_DEDUPE_DEFAULTS.requestTimeoutMs,
  collectImageUrls = false,
  blogApiBase = BLOG_API_BASE,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const windowStart = shiftCoverageDate(coverageDate, -(Math.max(1, lookbackDays) - 1))
  const sameDayTopicKeys = new Set()
  const usedImageUrls = new Set()
  const recentPosts = []
  let degraded = false

  for (let page = 1; page <= maxListPages; page += 1) {
    let payload = null
    try {
      const response = await fetchImpl(`${blogApiBase}/api/posts?page=${page}&page_size=${listPageSize}`, {
        headers: { 'User-Agent': 'AutoBlogBot/3.0' },
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      payload = await response.json()
    } catch (error) {
      // Silently returning an empty set here used to disable dedupe outright whenever the
      // backend hiccuped, with nothing in the log to say so. Degrading is still the right
      // call, but it has to be visible.
      degraded = true
      logger?.warn?.(`Cross-day dedupe DEGRADED: post list page ${page} unavailable (${error?.message || error}); duplicate topics${collectImageUrls ? ' and duplicate illustrations' : ''} may be republished.`)
      break
    }

    const items = Array.isArray(payload?.items) ? payload.items : []
    let inWindow = 0
    for (const post of items) {
      if (!isCoverageDateInWindow(post?.coverage_date, windowStart, coverageDate)) continue
      inWindow += 1
      const slug = String(post?.slug || '').trim()
      const topicKey = String(post?.topic_key || '').trim() || parseBriefSlug(slug)?.topic_key || ''
      if (String(post?.coverage_date || '').trim() === coverageDate) {
        const sameDayKey = String(post?.topic_key || '').trim() || inferTopicKeyFromSlug(slug, coverageDate)
        if (sameDayKey) sameDayTopicKeys.add(sameDayKey)
      }
      if (slug) recentPosts.push({ slug, topic_key: topicKey, coverage_date: String(post?.coverage_date || '').trim() })
    }

    if (items.length < listPageSize) break
    // The list is ordered pinned-first then newest-first, so pinned strays can only sit on
    // page 1. A later page with nothing in the window means we have walked past it.
    if (page > 1 && inWindow === 0) break
  }

  const selected = recentPosts.slice(0, maxDetailFetches)
  if (recentPosts.length > selected.length) {
    degraded = true
    logger?.warn?.(`Cross-day dedupe DEGRADED: ${recentPosts.length} posts in the ${lookbackDays}-day window exceed the ${maxDetailFetches}-detail budget; only the newest ${selected.length} were fingerprinted.`)
  }

  const fingerprints = []
  let detailFailures = 0
  for (const post of selected) {
    const { urls, imageUrls, ok } = await fetchPublishedPostSourceUrls({
      slug: post.slug,
      blogApiBase,
      fetchImpl,
      requestTimeoutMs,
      logger,
      collectImageUrls,
    })
    if (!ok) detailFailures += 1
    if (urls.size > 0) fingerprints.push({ ...post, source_urls: urls })
    for (const imageUrl of imageUrls || []) {
      const key = normalizeImageUrlForDedupe(imageUrl)
      if (key) usedImageUrls.add(key)
    }
  }

  if (detailFailures > 0) degraded = true
  logger?.log?.(`Cross-day dedupe: ${fingerprints.length}/${selected.length} published posts fingerprinted since ${windowStart}${detailFailures > 0 ? ` (${detailFailures} unreadable)` : ''}.`)
  if (collectImageUrls) {
    logger?.log?.(`Cross-post image dedupe: ${usedImageUrls.size} illustration fingerprint(s) collected from ${selected.length} published post(s) since ${windowStart}.`)
    // A partially read window is exactly how a duplicate slips through, so say it out loud
    // rather than letting the guard look healthy while running on half a memory.
    if (degraded) {
      logger?.warn?.('Cross-post image dedupe DEGRADED: the published-image memory is incomplete; an illustration already used by another article may be republished.')
    }
  }

  return {
    fingerprints,
    same_day_topic_keys: sameDayTopicKeys,
    used_image_urls: usedImageUrls,
    degraded,
    scanned_post_count: selected.length,
    window_start: windowStart,
  }
}

// --- Cross-post illustration dedupe -------------------------------------------------------
//
// Cross-day topic dedupe stops the same *story* from being written twice; it says nothing
// about the same *picture* being embedded twice. Most source pages only expose an og:image,
// and plenty of sites ship one social card for a whole section, so two genuinely different
// articles that cite the same origin end up with byte-identical illustrations. Production
// sampling found 38 inline images across 25 posts collapsing to 23 distinct URLs, one social
// card appearing in five separate articles.
//
// So the picker gets a memory: every illustration a recently published article already uses
// is excluded from the next one. The "already used" set is built from the very same
// `/api/posts/{slug}` payloads the cross-day guard downloads (content_md rides along in the
// detail response), so the guard costs no extra request.

// Renditions of one asset must collapse to one key, otherwise the guard misses exactly the
// duplicates it exists for. Real shapes seen in production:
//   …/Gemini_Generated_Image_x.width-200.png ↔ …/Gemini_Generated_Image_x.width-1440.png
//   …/FutureLabs_social.max-1440x810.png     ↔ …/FutureLabs_social.max-800x450.png
//   …/photo-1024x576.jpg                     ↔ …/photo.jpg
//   …/logo@2x.png                            ↔ …/logo.png
const IMAGE_RENDITION_SUFFIX_PATTERNS = [
  /\.width-\d+$/i,
  /\.height-\d+$/i,
  /\.max-\d+x\d+$/i,
  // Google's gweb-uniblog CDN — the single biggest source of illustrations in this blog —
  // stacks the format after the size: `Screenshot_….width-1200.format-webp.webp`. Without
  // stripping `.format-…` first, the anchored `.width-…` pattern never matches and two
  // renditions of one screenshot keep two distinct de-duplication keys.
  /\.format-[a-z0-9]+$/i,
  /[-_]\d{2,5}x\d{2,5}$/,
  /@\d+(?:\.\d+)?x$/i,
  /[-_]scaled$/i,
]

// Query-string renditions (imgix/Cloudinary/WordPress photon style). Deliberately a closed
// list: dropping every parameter would merge distinct assets served off one path.
const IMAGE_RENDITION_QUERY_KEYS = new Set([
  'w', 'h', 'width', 'height', 'maxwidth', 'maxheight', 'max-w', 'max-h', 'max_width', 'max_height',
  'size', 'fit', 'crop', 'resize', 'rect', 'zoom', 'dpr', 'quality', 'q', 'fm', 'format', 'auto',
  'strip', 'ssl', 'downsize', 'wpsize', 'sharp', 'blur',
])

function stripImageRenditionSuffix(stem) {
  let value = String(stem || '')
  for (let pass = 0; pass < 4; pass += 1) {
    const before = value
    for (const pattern of IMAGE_RENDITION_SUFFIX_PATTERNS) {
      value = value.replace(pattern, '')
    }
    if (value === before) break
  }
  return value || String(stem || '')
}

// Some CDNs truncate a generated file name when they build a rendition, which shows up as a
// repeated token run being cut short: `Gemini_Generated_Image_k2dxu1k2dxu1k2dx` and
// `Gemini_Generated_Image_k2dxu1k2dx` are the same picture. Folding adjacent repeats of the
// same run gives both variants one key. The 4-character floor keeps it from chewing through
// ordinary names, and the worst case if it over-folds is one extra illustration treated as a
// duplicate — never a wrong picture or a failed run.
function collapseRepeatedRuns(value, { minUnit = 4, maxPasses = 6, maxLength = 120 } = {}) {
  let text = String(value || '')
  if (text.length > maxLength) return text
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let next = text
    for (let start = 0; start < text.length && next === text; start += 1) {
      const maxUnit = Math.floor((text.length - start) / 2)
      for (let unit = maxUnit; unit >= minUnit; unit -= 1) {
        if (text.slice(start, start + unit) !== text.slice(start + unit, start + unit * 2)) continue
        next = text.slice(0, start + unit) + text.slice(start + unit * 2)
        break
      }
    }
    if (next === text) return text
    text = next
  }
  return text
}

// Returns a comparison key, not a usable URL: scheme and host case are folded away, and the
// path keeps its original case because object-storage keys are case-sensitive and folding it
// would merge distinct R2 objects.
export function normalizeImageUrlForDedupe(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  let url
  try {
    url = new URL(raw)
  } catch {
    return raw.toLowerCase()
  }
  if (!/^https?:$/i.test(url.protocol)) return raw.toLowerCase()

  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (
      IMAGE_RENDITION_QUERY_KEYS.has(key.toLowerCase())
      || /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|v$|ver$|rev$|cb$)/i.test(key)
    ) {
      url.searchParams.delete(key)
    }
  }
  const query = [...url.searchParams.entries()]
    .sort((left, right) => (left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0])))
    .map(([key, entryValue]) => `${key}=${entryValue}`)
    .join('&')

  const segments = url.pathname.split('/')
  const fileName = segments.pop() || ''
  const dotIndex = fileName.lastIndexOf('.')
  const extension = dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : ''
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName
  segments.push(`${collapseRepeatedRuns(stripImageRenditionSuffix(stem))}${extension}`)

  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const path = segments.join('/').replace(/\/+$/, '')
  return `${host}${path}${query ? `?${query}` : ''}`
}

// `![alt](url "title")`, `![alt](<url>)` and bare `![](url)` all appear in published bodies.
const INLINE_IMAGE_URL_PATTERN = /!\[[^\]]*\]\(\s*<?([^)\s<>]+)>?[^)]*\)/g

export function extractInlineImageUrlsFromMarkdown(markdown) {
  const urls = []
  const seen = new Set()
  for (const match of String(markdown || '').matchAll(INLINE_IMAGE_URL_PATTERN)) {
    const raw = String(match[1] || '').trim().replace(/[).,;]+$/, '')
    if (!raw || !/^https?:\/\//i.test(raw) || seen.has(raw)) continue
    seen.add(raw)
    urls.push(raw)
  }
  return urls
}

export const IMAGE_DEDUPE_DEFAULTS = {
  enabled: true,
  // Wider than the topic window on purpose: a story is stale after a week, a picture the
  // reader saw two weeks ago still reads as a repeat.
  lookbackDays: 14,
  maxListPages: 4,
  listPageSize: 50,
  maxDetailFetches: 30,
  requestTimeoutMs: 10000,
}

export function resolveImageDedupeConfig(config = {}, modeConfig = {}) {
  const root = { ...(config?.image_dedupe || {}), ...(modeConfig?.image_dedupe || {}) }
  const defaults = IMAGE_DEDUPE_DEFAULTS
  return {
    enabled: Boolean(root.enabled ?? defaults.enabled),
    lookbackDays: clampNumber(root.lookback_days, { fallback: defaults.lookbackDays, min: 1, max: 90, integer: true }),
    maxListPages: clampNumber(root.max_list_pages, { fallback: defaults.maxListPages, min: 1, max: 10, integer: true }),
    // The public list endpoint caps page_size at 50; asking for more is a 422.
    listPageSize: clampNumber(root.list_page_size, { fallback: defaults.listPageSize, min: 1, max: 50, integer: true }),
    maxDetailFetches: clampNumber(root.max_detail_fetches, { fallback: defaults.maxDetailFetches, min: 0, max: 100, integer: true }),
    requestTimeoutMs: clampNumber(root.request_timeout_ms, { fallback: defaults.requestTimeoutMs, min: 1000, max: 60000, integer: true }),
  }
}

// A mutable memory shared across every post of one run: seeded with what recent articles
// already published, then grown as this run picks images, so two posts of the same batch
// cannot land on the same picture either.
export function createUsedImageRegistry(initialUrls = []) {
  const keys = new Set()
  const add = (url) => {
    const key = normalizeImageUrlForDedupe(url)
    if (key) keys.add(key)
    return key
  }
  const has = (url) => {
    const key = normalizeImageUrlForDedupe(url)
    return Boolean(key) && keys.has(key)
  }
  const source = initialUrls instanceof Set || Array.isArray(initialUrls) ? initialUrls : []
  for (const url of source) {
    // History arrives pre-normalized from the fetch layer; re-normalizing is idempotent.
    if (url) keys.add(normalizeImageUrlForDedupe(url) || String(url))
  }
  return {
    keys,
    add,
    has,
    get size() {
      return keys.size
    },
  }
}

// Belt-and-braces layer: even if the picker never learns the exclusion parameter, a plan that
// points at an already-used illustration is dropped before the article is assembled. Runs
// before AI illustration fill-in so a dropped duplicate can still be replaced.
export function dedupeImagePlansAgainstUsed(imagePlans, registry, { logger = console } = {}) {
  const plans = Array.isArray(imagePlans) ? imagePlans : []
  if (!registry || plans.length === 0) return plans
  const kept = []
  const dropped = []
  for (const plan of plans) {
    const imageUrl = String(plan?.image_url || '').trim()
    if (!imageUrl) continue
    if (registry.has(imageUrl)) {
      dropped.push(plan)
      continue
    }
    registry.add(imageUrl)
    kept.push(plan)
  }
  if (dropped.length > 0) {
    logger?.log?.(`Cross-post image dedupe dropped ${dropped.length} illustration(s) already used elsewhere: ${dropped.map((plan) => plan.image_url).join(', ')}`)
  }
  return kept
}

// Single place where the guard is switched off, so `--force` cannot drift out of sync
// between the same-day and the cross-day check.
export async function resolvePublishedTopicGuards(runtime = {}, { coverageDate, fetchImpl = fetch, logger = console } = {}) {
  const empty = {
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [],
    usedImageUrls: new Set(),
    degraded: false,
    bypassed: true,
  }
  if (!runtime.skipPublishedTopicKeys || runtime.force || runtime.dryRun) return empty

  const dedupe = runtime.crossDayDedupe || resolveCrossDayDedupeConfig()
  // Opt-in, unlike `crossDayDedupe` above: this guard rides on the topic scan's per-post
  // detail requests, so a caller that never asked for image dedupe must not start paying for
  // them. Every run mode that picks source images sets `imageDedupe` on its runtime.
  const imageDedupe = runtime.imageDedupe || { ...IMAGE_DEDUPE_DEFAULTS, enabled: false }
  if (!dedupe.enabled && !imageDedupe.enabled) {
    return {
      publishedTopicKeys: await fetchPublishedTopicKeys({ coverageDate, fetchImpl }),
      publishedTopicFingerprints: [],
      usedImageUrls: new Set(),
      degraded: false,
      bypassed: false,
    }
  }

  // One list pass and one round of detail fetches feed both guards. The scan budget is the
  // union of what each guard asks for, never the sum.
  const budget = (crossDayValue, imageValue, floor) => Math.max(
    dedupe.enabled ? crossDayValue : floor,
    imageDedupe.enabled ? imageValue : floor,
  )
  const recent = await fetchRecentPublishedTopicFingerprints({
    coverageDate,
    lookbackDays: budget(dedupe.lookbackDays, imageDedupe.lookbackDays, 1),
    maxListPages: budget(dedupe.maxListPages, imageDedupe.maxListPages, 1),
    listPageSize: budget(dedupe.listPageSize, imageDedupe.listPageSize, 1),
    maxDetailFetches: budget(dedupe.maxDetailFetches, imageDedupe.maxDetailFetches, 0),
    requestTimeoutMs: budget(dedupe.requestTimeoutMs, imageDedupe.requestTimeoutMs, 1000),
    collectImageUrls: imageDedupe.enabled,
    fetchImpl,
    logger,
  })

  // Image dedupe looks further back than topic dedupe, so the extra rows must not silently
  // widen the topic-overlap window as a side effect of sharing one scan.
  const crossDayWindowStart = shiftCoverageDate(coverageDate, -(Math.max(1, dedupe.lookbackDays) - 1))
  return {
    publishedTopicKeys: recent.same_day_topic_keys,
    publishedTopicFingerprints: dedupe.enabled
      ? recent.fingerprints.filter((entry) => isCoverageDateInWindow(entry.coverage_date, crossDayWindowStart, coverageDate))
      : [],
    usedImageUrls: imageDedupe.enabled ? recent.used_image_urls : new Set(),
    degraded: recent.degraded,
    bypassed: false,
  }
}

// Standalone entry for run modes that publish a single post and therefore never build the
// topic guards (weekly review). Failure degrades to an empty memory, loudly.
export async function resolveUsedImageRegistry(runtime = {}, { coverageDate, fetchImpl = fetch, logger = console } = {}) {
  // Standalone entry, so the default here is the feature's own default rather than "off".
  const imageDedupe = runtime.imageDedupe || resolveImageDedupeConfig()
  if (!imageDedupe.enabled || runtime.force || runtime.dryRun) return createUsedImageRegistry()
  try {
    const recent = await fetchRecentPublishedTopicFingerprints({
      coverageDate,
      lookbackDays: imageDedupe.lookbackDays,
      maxListPages: imageDedupe.maxListPages,
      listPageSize: imageDedupe.listPageSize,
      maxDetailFetches: imageDedupe.maxDetailFetches,
      requestTimeoutMs: imageDedupe.requestTimeoutMs,
      collectImageUrls: true,
      fetchImpl,
      logger,
    })
    return createUsedImageRegistry(recent.used_image_urls)
  } catch (error) {
    logger?.warn?.(`Cross-post image dedupe DEGRADED: could not read the published-image memory (${error?.message || error}); duplicate illustrations may be published.`)
    return createUsedImageRegistry()
  }
}

export function selectTopicsForPublishing(topics, runtime) {
  const publishedTopicKeys = runtime.publishedTopicKeys || new Set()
  const publishedFingerprints = Array.isArray(runtime.publishedTopicFingerprints) ? runtime.publishedTopicFingerprints : []
  const overlapThreshold = Number.isFinite(Number(runtime.overlapThreshold))
    ? Number(runtime.overlapThreshold)
    : CROSS_DAY_DEDUPE_DEFAULTS.overlapThreshold
  const minSharedSources = Number.isFinite(Number(runtime.minSharedSources))
    ? Number(runtime.minSharedSources)
    : CROSS_DAY_DEDUPE_DEFAULTS.minSharedSources
  const maxPosts = Math.max(1, Number(runtime.maxPosts || 1))
  const minSourcesSoft = Math.max(1, Number(runtime.minSourcesPerTopic || 1))
  const skippedTopics = []

  const queue = [...(topics || [])]
    .filter((topic) => topic.items?.length > 0)
    .filter((topic) => {
      if (publishedTopicKeys.has(topic.topic_key)) {
        skippedTopics.push({ topic_key: topic.topic_key, reason: 'already published for coverage date' })
        return false
      }
      const overlap = findPublishedTopicOverlap(topic, publishedFingerprints, { overlapThreshold, minSharedSources })
      if (overlap) {
        skippedTopics.push({
          ...overlap,
          topic_key: topic.topic_key,
          reason: `source overlap ${Math.round(overlap.overlap_ratio * 100)}% with ${overlap.post_slug || 'a recent post'}${overlap.coverage_date ? ` (${overlap.coverage_date})` : ''}`,
        })
        return false
      }
      return true
    })
    .sort((left, right) => {
      const leftBoost = left.source_count >= minSourcesSoft ? 1 : 0
      const rightBoost = right.source_count >= minSourcesSoft ? 1 : 0
      if (rightBoost !== leftBoost) return rightBoost - leftBoost
      if ((right.bucket_count || 0) !== (left.bucket_count || 0)) return (right.bucket_count || 0) - (left.bucket_count || 0)
      if ((right.non_official_source_count || 0) !== (left.non_official_source_count || 0)) {
        return (right.non_official_source_count || 0) - (left.non_official_source_count || 0)
      }
      if (right.source_count !== left.source_count) return right.source_count - left.source_count
      if (right.score !== left.score) return right.score - left.score
      return scoreTimestamp(right.latest_published_at) - scoreTimestamp(left.latest_published_at)
    })

  return {
    queue,
    target_count: maxPosts,
    // Keeps carrying every already-published key (even ones this run never saw as a
    // candidate) so the publishing-status report stays complete, now unioned with the
    // cross-day overlap skips.
    skipped_topic_keys: [...new Set([
      ...publishedTopicKeys,
      ...skippedTopics.map((entry) => entry.topic_key).filter(Boolean),
    ])],
    skipped_topics: skippedTopics,
  }
}

function stringifyPromptPayload(payload, maxChars = 18000) {
  return smartTruncate(JSON.stringify(payload, null, 2), maxChars)
}

function stripMarkdownForLength(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[>*_\-|]/g, ' ')
    .replace(/\s+/g, '')
}

function extractArticleSections(contentMd, headings) {
  const lines = String(contentMd || '').split('\n')
  const indexes = headings
    .map((heading) => ({ heading, index: lines.findIndex((line) => line.trim() === heading.trim()) }))
    .filter((entry) => entry.index >= 0)

  const sections = new Map()
  for (let idx = 0; idx < indexes.length; idx += 1) {
    const current = indexes[idx]
    const next = indexes[idx + 1]
    const endIndex = next ? next.index : lines.length
    sections.set(current.heading, lines.slice(current.index, endIndex).join('\n').trim())
  }

  for (const heading of headings) {
    if (!sections.has(heading)) {
      sections.set(heading, `${heading}\n\n`)
    }
  }

  return sections
}

export function ensureSectionHeading(markdown, heading) {
  const text = String(markdown || '').trim()
  if (!text) return `${heading}\n\n`
  if (text.startsWith(heading)) return text
  // Only a heading on the very first line is the model's own (wrong) chapter title and may
  // be replaced. The previous `/^#{1,6}\s+.*$/m` matched the first heading *anywhere*, so a
  // section that opened with prose and used a legitimate `###` subheading later lost that
  // subheading on every normalization pass.
  const withoutLeadingHeading = /^#{1,6}\s+/.test(text)
    ? text.replace(/^#{1,6}\s+[^\n]*\r?\n?/, '').trim()
    : text
  return `${heading}\n\n${withoutLeadingHeading}`
}

// Rebuild an article after a partial repair by splicing ONLY the repaired chapters back
// into the original Markdown.
//
// The previous implementation rebuilt the whole article from `requiredSections.map(...)`,
// which meant: (a) the lede before the first heading was destroyed on every repair pass,
// and (b) if the model had renamed a heading (a space, a different 顿号) nothing matched,
// so a single repair could collapse the entire article into a handful of empty headings.
export function spliceRepairedSections(originalContent, headings, repairedByHeading) {
  const lines = String(originalContent || '').split('\n')
  const headingLineIndexes = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) headingLineIndexes.push(index)
  }

  const placed = []
  const appended = []
  for (const heading of Array.isArray(headings) ? headings : []) {
    const markdown = String(repairedByHeading?.get?.(heading) || '').trim()
    if (!markdown) continue
    const start = lines.findIndex((line) => line.trim() === String(heading).trim())
    if (start < 0) {
      // The chapter is not in the current draft at all (a missing_sections failure);
      // append it instead of overwriting an unrelated block.
      appended.push(markdown)
      continue
    }
    // End at the next level-2 heading, even one the model invented, so a repaired chapter
    // never swallows the chapter after it.
    const nextHeadingIndex = headingLineIndexes.find((index) => index > start)
    placed.push({ start, end: nextHeadingIndex === undefined ? lines.length : nextHeadingIndex, markdown })
  }

  const output = [...lines]
  for (const edit of placed.sort((left, right) => right.start - left.start)) {
    output.splice(edit.start, edit.end - edit.start, ...edit.markdown.split('\n'), '')
  }

  return [output.join('\n').trim(), ...appended].filter(Boolean).join('\n\n')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findJsonPayload(text) {
  const source = String(text || '').trim()
  const start = source.search(/[\[{]/)
  if (start < 0) return source

  const stack = []
  let inString = false
  let escaped = false

  for (let index = start; index < source.length; index += 1) {
    const char = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      const opener = stack.pop()
      if ((char === '}' && opener !== '{') || (char === ']' && opener !== '[')) {
        throw new Error(`JSON has mismatched closing ${char}`)
      }
      if (stack.length === 0) return source.slice(start, index + 1)
    }
  }

  if (stack.length > 0) {
    throw new Error('JSON appears truncated: top-level braces are not balanced')
  }

  return source.slice(start)
}

export function parseJsonFromLlm(raw) {
  let text = String(raw || '').trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/m, '').trim()
  }
  return JSON.parse(findJsonPayload(text))
}

async function getCachedAdminToken() {
  if (!adminTokenCache) {
    adminTokenCache = await getAdminToken()
  }
  return adminTokenCache
}

function clearAdminTokenCache() {
  adminTokenCache = ''
}

// Only a deterministic request-shape rejection justifies shrinking max_tokens for the next
// attempt. The previous code set providerRejected on *every* non-401/403 failure, so an
// AbortError / 240s timeout / "fetch failed" cut the budget from 16384 to 8192 — making the
// next attempt more likely to truncate, which then looked like another failure. That is a
// reinforcing loop: the flakier the network, the shorter the article.
export function isProviderParameterRejection(message) {
  const text = String(message || '')
  if (/^Admin text generation failed:\s*(400|413|422)\b/i.test(text)) return true
  return /max[_\s-]?tokens|context[_\s-]?length|maximum context|token limit|too many tokens|exceeds? the (?:model|maximum)/i.test(text)
}

// Minimal shape checks for LLM JSON. Without them a structurally wrong-but-parseable
// payload (outline.outline returned as a string, a section returned under an unexpected
// key, a package with no title) produced an empty article, burned the whole repair budget
// on nothing, and only surfaced as an exception several thousand tokens later.
export function validateOutlinePayload(outline, { isFreeStructure = false } = {}) {
  if (!outline || typeof outline !== 'object' || Array.isArray(outline)) {
    return { ok: false, reason: 'outline must be a JSON object' }
  }
  if (!String(outline.topic || '').trim()) {
    return { ok: false, reason: 'outline.topic is missing or empty' }
  }
  const briefHeadings = Array.isArray(outline.section_briefs)
    ? outline.section_briefs.filter((brief) => String(brief?.heading || '').trim())
    : []
  if (isFreeStructure) {
    const headings = Array.isArray(outline.outline)
      ? outline.outline.filter((item) => String(item || '').trim())
      : []
    if (headings.length === 0 && briefHeadings.length === 0) {
      return { ok: false, reason: 'outline.outline must be a non-empty array of headings (or section_briefs must carry headings)' }
    }
    if (!Array.isArray(outline.outline) && briefHeadings.length === 0) {
      return { ok: false, reason: `outline.outline must be an array, received ${typeof outline.outline}` }
    }
  }
  return { ok: true }
}

export function validateArticlePackagePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'package must be a JSON object' }
  }
  if (!String(payload.title || '').trim()) {
    return { ok: false, reason: 'package.title is missing or empty' }
  }
  return { ok: true }
}

export function readSectionMarkdown(result) {
  if (typeof result === 'string') return result
  if (!result || typeof result !== 'object') return ''
  return String(result.markdown || result.section_md || result.content_md || '')
}

export function validateSectionPayload(result, { minChars = 40 } = {}) {
  const markdown = readSectionMarkdown(result).trim()
  if (!markdown) {
    return {
      ok: false,
      reason: `section payload has no markdown/section_md/content_md string (keys: ${
        result && typeof result === 'object' ? Object.keys(result).join(',') || 'none' : typeof result
      })`,
    }
  }
  if (markdown.length < minChars) {
    return { ok: false, reason: `section markdown is only ${markdown.length} chars` }
  }
  return { ok: true }
}

export function buildLLMMaxTokenAttempts(maxTokens = 16384) {
  const requested = Math.max(1, Math.floor(Number(maxTokens) || 16384))
  return [requested, 8192, 4096, 3072]
    .map((value) => Math.min(requested, value))
    .filter((value, index, values) => values.indexOf(value) === index)
}

export async function callLLM(systemPrompt, userPrompt, maxTokens = 16384, {
  generateText = generateTextViaAdminApi,
  getToken = getCachedAdminToken,
  clearToken = clearAdminTokenCache,
  sleepImpl = sleep,
  blogApiBase = BLOG_API_BASE,
  retryDelaysSec = [0, 10, 30, 60],
  logger = console,
  // Optional shape check. A payload that parses but fails the check is retried inside this
  // loop (keeping the full token budget), instead of flowing downstream as an empty article.
  validate = null,
} = {}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const maxTokenAttempts = buildLLMMaxTokenAttempts(maxTokens)
  const attempts = retryDelaysSec.length
  // The token ladder only steps down when the provider itself rejects the request
  // (e.g. max_tokens above a model limit). A truncated/unparseable body means the
  // request succeeded but the output was cut off, so reducing the budget would only
  // make truncation worse — those retries keep the full budget.
  let tokenLadderIndex = 0
  // A cached admin token can expire mid-run (a weekly review makes many sequential
  // LLM calls, each up to 240s). The first 401/403 is treated as a stale token: clear
  // the cache so the next getToken re-logs in, then retry once. A second auth failure
  // after a fresh login is a genuine credentials problem and is re-raised.
  let reauthAttempted = false
  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      const sec = retryDelaysSec[attempt - 1]
      logger?.log?.(`Retrying LLM call in ${sec}s...`)
      await sleepImpl(sec * 1000)
    }

    const maxTokensForAttempt = maxTokenAttempts[Math.min(tokenLadderIndex, maxTokenAttempts.length - 1)]
    if (maxTokensForAttempt !== maxTokens) {
      logger?.log?.(`Retrying LLM call with reduced max_tokens=${maxTokensForAttempt} (requested ${maxTokens})...`)
    }

    let providerRejected = false
    for (const jsonMode of [true, false]) {
      try {
        const raw = await generateText({
          blogApiBase,
          token: await getToken(),
          messages,
          maxTokens: maxTokensForAttempt,
          temperature: 0.55,
          jsonMode,
          timeoutMs: 240000,
        })
        try {
          const parsed = parseJsonFromLlm(raw)
          const validation = validate ? validate(parsed) : null
          if (!validation || validation.ok !== false) return parsed
          lastError = `LLM output failed shape check (${validation.reason || 'unknown'}): preview=${String(raw).slice(0, 220)}`
          logger?.log?.(`LLM output rejected by shape check: ${validation.reason || 'unknown'}; retrying...`)
        } catch (error) {
          const rawText = String(raw)
          const preview = rawText.slice(0, 220)
          const tail = rawText.length > 220 ? rawText.slice(-220) : ''
          lastError = `JSON parse failed (${error?.message || 'unknown parse error'}): preview=${preview}${tail ? ` tail=${tail}` : ''}`
        }
      } catch (error) {
        lastError = error?.message || 'admin text generation failed'
        if (/^Admin text generation failed:\s*(401|403)\b/i.test(lastError)) {
          if (reauthAttempted) throw error
          reauthAttempted = true
          clearToken?.()
          logger?.log?.('Admin token rejected (401/403); clearing cache and re-authenticating...')
          continue
        }
        if (isProviderParameterRejection(lastError)) providerRejected = true
      }
    }

    if (providerRejected) tokenLadderIndex += 1
  }

  throw new Error(`LLM failed after retries: ${lastError.slice(0, 500)}`)
}

export function createDailyBriefFormatProfile() {
  // Daily briefs now use free structure: the LLM authors its own chapter titles and the
  // quality gate enforces dimension coverage instead of a fixed 5-section template. We keep
  // the daily-specific title/summary/style overrides but inherit structure_mode/required_
  // dimensions/outline_rules from free-form-v1.
  const baseProfile = getBlogFormatProfile('free-form-v1')
  return {
    ...baseProfile,
    name: 'daily_brief',
    required_sections: [],
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

export function pickPostCountForRun({
  mode = 'daily-auto',
  minPosts = 1,
  maxPosts = 1,
  randomValue = Math.random(),
} = {}) {
  const min = Math.max(1, Math.floor(Number(minPosts) || 1))
  const max = Math.max(min, Math.floor(Number(maxPosts) || min))

  if (mode !== 'daily-auto' || min === max) {
    return max
  }

  const normalized = Math.min(0.999999, Math.max(0, Number(randomValue) || 0))
  return min + Math.floor(normalized * (max - min + 1))
}

function resolveDailyRuntime(config, cliOptions) {
  const mode = cliOptions.mode || config.default_mode || 'daily-auto'
  const dailyConfig = config.daily_auto || {}
  const manualConfig = config.daily_manual || {}
  const modeConfig = mode === 'daily-manual' ? manualConfig : dailyConfig
  const explicitMaxPosts = cliOptions.maxPosts ? Math.max(1, Number(cliOptions.maxPosts)) : null
  const minPosts = Math.max(1, Number(modeConfig.min_posts_per_run || dailyConfig.min_posts_per_run || 1))
  const maxPosts = explicitMaxPosts || Math.max(1, Number(modeConfig.max_posts_per_run || dailyConfig.max_posts_per_run || 2))

  return {
    mode,
    dryRun: cliOptions.dryRun,
    coverageDate: toCoverageDate(cliOptions.coverageDate),
    maxPosts: pickPostCountForRun({
      mode,
      minPosts,
      maxPosts,
    }),
    // Code-side fallbacks must mirror config/auto-blog.config.json. They drifted (30 vs 36,
    // 24 vs 40, 2 vs 3), so any missing config key quietly enforced a different policy than
    // the one the file documents.
    lookbackHours: Number(modeConfig.lookback_hours || dailyConfig.lookback_hours || 36),
    maxCandidateItems: Number(modeConfig.max_candidate_items || dailyConfig.max_candidate_items || 40),
    minSourcesPerTopic: Number(modeConfig.min_sources_per_topic || dailyConfig.min_sources_per_topic || 3),
    sectionTargetChars: Number(modeConfig.section_target_chars || dailyConfig.section_target_chars || 850),
    feedLimit: Number(modeConfig.base_feed_limit || dailyConfig.base_feed_limit || 60),
    enrichLimit: Number(modeConfig.base_enrich_limit || dailyConfig.base_enrich_limit || 20),
    clusterSimilarityThreshold: Number(modeConfig.cluster_similarity_threshold || dailyConfig.cluster_similarity_threshold || 0.5),
    enableBlogwatcherFallback: Boolean(modeConfig.enable_blogwatcher_fallback ?? dailyConfig.enable_blogwatcher_fallback ?? false),
    skipPublishedTopicKeys: Boolean(modeConfig.skip_published_topic_keys ?? true),
    crossDayDedupe: resolveCrossDayDedupeConfig(config, modeConfig),
    imageDedupe: resolveImageDedupeConfig(config, modeConfig),
    force: cliOptions.force,
  }
}

function isWeeklyReviewWorkflow(workflow, formatProfile) {
  return workflow?.content_type === 'weekly_review' || String(formatProfile?.name || '').startsWith('weekly-review')
}

function resolveGateProfile(config = {}, contentType = '') {
  const root = config.quality_gate || {}
  if (contentType && root[contentType] && typeof root[contentType] === 'object') {
    return root[contentType]
  }
  return root
}

export function assessResearchPackSourceSupport({ researchPack, gateProfile }) {
  const sources = dedupeResearchItems(Array.isArray(researchPack?.sources) ? researchPack.sources : [])
  const minSources = Math.max(0, Number(gateProfile?.min_sources || 0))
  const minHighQualitySources = Math.max(0, Number(gateProfile?.min_high_quality_sources || 0))
  const minDomains = Math.max(0, Number(gateProfile?.min_cited_domains || gateProfile?.min_unique_domains || 0))
  const highQualityTypes = new Set(
    Array.isArray(gateProfile?.high_quality_source_types) ? gateProfile.high_quality_source_types : []
  )
  const highQualitySources = sources.filter((item) => highQualityTypes.has(item?.source_type))
  const uniqueDomains = new Set(sources.map((item) => item?.domain || extractDomain(item?.url)).filter(Boolean))
  const reasons = []

  if (sources.length < minSources) {
    reasons.push(`sources:${sources.length}<${minSources}`)
  }
  if (highQualitySources.length < minHighQualitySources) {
    reasons.push(`high_quality_sources:${highQualitySources.length}<${minHighQualitySources}`)
  }
  if (minDomains > 0 && uniqueDomains.size < minDomains) {
    reasons.push(`domains:${uniqueDomains.size}<${minDomains}`)
  }

  return {
    passed: reasons.length === 0,
    reasons,
    metrics: {
      source_count: sources.length,
      high_quality_source_count: highQualitySources.length,
      unique_domain_count: uniqueDomains.size,
    },
  }
}

async function runDailyArxivSupplement({ config, topic, maxPapers = null }) {
  const keywords = [
    ...(Array.isArray(topic?.keywords) ? topic.keywords : []),
    topic?.candidate_title || topic?.title || '',
    ...(Array.isArray(topic?.source_groups) ? topic.source_groups : []),
  ].filter(Boolean)
  if (keywords.length === 0) return []
  try {
    const papers = await runArxiv({
      keywords,
      maxPapers: maxPapers || Number(config.arxiv_max_papers || 2),
      config,
      mode: 'daily',
    })
    if (papers.length > 0) {
      console.log(`Daily arXiv supplement for ${topic?.topic_key || topic?.candidate_title}: ${papers.length} paper(s).`)
    }
    return papers
  } catch (error) {
    console.warn(`Daily arXiv supplement skipped: ${error.message}`)
    return []
  }
}

export function normalizeOutlineHeadings(outline) {
  // Free mode: the LLM authors its own H2 chapter titles, returned either as outline.outline
  // (array of headings) or implied by section_briefs[].heading. Normalize both to a clean,
  // deduped, "## "-prefixed list of body headings (tail blocks are appended by the program).
  const raw = []
  if (Array.isArray(outline?.outline)) {
    raw.push(...outline.outline)
  }
  if (raw.length === 0 && Array.isArray(outline?.section_briefs)) {
    raw.push(...outline.section_briefs.map((brief) => brief?.heading))
  }
  const seen = new Set()
  const headings = []
  for (const item of raw) {
    let heading = String(item || '').trim()
    if (!heading) continue
    if (!heading.startsWith('#')) heading = `## ${heading}`
    heading = heading.replace(/^#{1,6}\s*/, '## ')
    if (seen.has(heading)) continue
    seen.add(heading)
    headings.push(heading)
  }
  return headings
}

export function normalizeSectionBriefs(outline, formatProfile) {
  const byHeading = new Map()
  for (const brief of Array.isArray(outline?.section_briefs) ? outline.section_briefs : []) {
    let heading = String(brief?.heading || '').trim()
    if (!heading) continue
    if (!heading.startsWith('#')) heading = `## ${heading}`
    heading = heading.replace(/^#{1,6}\s*/, '## ')
    byHeading.set(heading, {
      heading,
      dimension: String(brief.dimension || '').trim(),
      goal: String(brief.goal || '').trim(),
      angle: String(brief.angle || '').trim(),
      key_points: Array.isArray(brief.key_points) ? brief.key_points.filter(Boolean).slice(0, 8) : [],
      must_use_sources: Array.isArray(brief.must_use_sources) ? brief.must_use_sources.filter(Boolean).slice(0, 8) : [],
      evidence_cards: Array.isArray(brief.evidence_cards) ? brief.evidence_cards.filter(Boolean).slice(0, 8) : [],
      source_focus: Array.isArray(brief.source_focus) ? brief.source_focus.filter(Boolean).slice(0, 8) : [],
      suggested_subheads: Array.isArray(brief.suggested_subheads) ? brief.suggested_subheads.filter(Boolean).slice(0, 5) : [],
      counterpoint: String(brief.counterpoint || '').trim(),
      style_constraints: Array.isArray(brief.style_constraints) ? brief.style_constraints.filter(Boolean).slice(0, 6) : [],
      avoid: Array.isArray(brief.avoid) ? brief.avoid.filter(Boolean).slice(0, 6) : [],
    })
  }

  const makeFallbackBrief = (heading, index, opener) => ({
    heading,
    dimension: '',
    goal: index === 0
      ? opener
      : 'Develop this section into a substantive analytical chapter tied to the topic.',
    angle: '',
    key_points: [],
    must_use_sources: [],
    evidence_cards: [],
    source_focus: [],
    suggested_subheads: [],
    counterpoint: '',
    style_constraints: [],
    avoid: [],
  })

  // Free mode: chapters come from the LLM-authored outline, not a fixed template. Fall back to
  // the brief headings themselves if outline.outline is absent.
  if (formatProfile?.structure_mode === 'free') {
    let headings = normalizeOutlineHeadings(outline)
    if (headings.length === 0) headings = [...byHeading.keys()]
    return headings.map((heading, index) => byHeading.get(heading)
      || makeFallbackBrief(heading, index, 'Open the article by establishing what happened and why it matters.'))
  }

  return formatProfile.required_sections.map((heading, index) => byHeading.get(heading)
    || makeFallbackBrief(heading, index, 'Open the article with a weekly overview and identify the main strategic shift.'))
}

// The topic-selection prompt serializes the *whole* research pack, so anything attached to it
// competes with the actual research for a hard 14k/22k character budget. `sources` now carries
// harvested image candidates (fat: url + alt + caption + surrounding prose, up to 12 per
// source), which would have pushed real evidence out of the prompt through smartTruncate.
// Re-compacting the rows drops them, exactly like the digest builders below already do.
function researchPackForPrompt(researchPack) {
  return {
    ...researchPack,
    sources: (researchPack?.sources || []).map(compactResearchItem),
  }
}

function buildWeeklyResearchDigest(researchPack, maxSources = 18) {
  return {
    summary: researchPack.summary,
    sources: (researchPack.sources || []).slice(0, maxSources).map(compactResearchItem),
    evidence_cards: (researchPack.evidence_cards || []).slice(0, maxSources),
    paper_items: (researchPack.paper_items || []).slice(0, 4),
  }
}

function buildDailyResearchDigest(researchPack, maxSources = 14) {
  return {
    summary: researchPack.summary,
    source_stats: researchPack.source_stats,
    sources: (researchPack.sources || []).slice(0, maxSources).map(compactResearchItem),
    evidence_cards: (researchPack.evidence_cards || []).slice(0, maxSources),
    paper_items: (researchPack.paper_items || []).slice(0, 3),
  }
}

async function chooseTopicDetailed({ researchPack, formatProfile, today, workflow }) {
  const isWeeklyReview = isWeeklyReviewWorkflow(workflow, formatProfile)
  const isFreeStructure = formatProfile?.structure_mode === 'free'
  const requiredDimensions = Array.isArray(formatProfile?.required_dimensions)
    ? formatProfile.required_dimensions
    : []
  const system = isWeeklyReview
    ? [
        'You are planning a premium Chinese weekly AI review.',
        'This is not a single-news article. It must synthesize the most important changes across the full week.',
        'Return JSON with keys:',
        'topic, thesis, keywords, arxiv_queries, outline, section_briefs, image_sections, key_sources, tags, cover_brief, watchlist',
        'Requirements:',
        '- Cover the week as a whole, not one company announcement.',
        '- The outline must use the exact required section headings provided by the format profile.',
        '- Provide section_briefs as an array. Each item must have heading, goal, angle, key_points, must_use_sources, evidence_cards, source_focus, suggested_subheads, counterpoint, style_constraints, avoid.',
        '- weekly_axes must contain 3 to 4 major weekly themes.',
        '- Add 8 to 14 third-level subheadings distributed across the middle and later sections.',
        '- key_sources must identify the source IDs or URLs that are truly central to the weekly argument.',
        '- section_briefs.source_focus and must_use_sources should prefer concrete source IDs such as S1/S2 from evidence_cards.',
        '- image_sections can include at most 3 section headings.',
        '- cover_brief must be a short content-only visual clue; do not prescribe medium, palette, composition, brand motifs, or negative prompts.',
      ].join('\n')
    : isFreeStructure
    ? [
        'You are planning a Chinese AI editorial article with one clear thesis.',
        'Return JSON with keys:',
        'topic, thesis, keywords, arxiv_queries, outline, section_briefs, evidence_cards, counterpoints, reader_question, image_sections, key_sources, tags, cover_brief',
        'Requirements:',
        '- Focus on one topic rather than a loose news digest.',
        '- You design the article structure yourself. Do NOT reuse fixed template chapter names.',
        '- outline must be an array of 3 to 6 concrete level-2 headings (each starting with "## ") that you invent for THIS article. Headings must be specific to the content, not generic template titles.',
        '- The chapters together must cover every required editorial dimension listed in the format profile.',
        `- Required dimensions to cover across the article: ${requiredDimensions.join(', ') || 'facts, significance, multi_source, analysis, judgment'}.`,
        '- section_briefs is required and must be one item per outline heading, in the same order. Each item must have: heading (exactly matching the outline heading), dimension (which required dimension this chapter primarily serves), goal, angle, key_points, must_use_sources, evidence_cards, source_focus, suggested_subheads, counterpoint, style_constraints, avoid.',
        '- Distribute the dimensions across chapters so the whole article covers all of them; a chapter may serve more than one dimension.',
        '- evidence_cards should select the strongest available source IDs and explain what each card supports, its caveat, and which sections should use it.',
        '- counterpoints must list 1 to 3 plausible objections, uncertainty points, or ways the thesis could be wrong.',
        '- reader_question should state the concrete question this article answers for readers.',
        '- Add 3 to 6 third-level subheadings across the middle and later chapters.',
        '- image_sections can include at most 3 headings, and must be chosen from your own outline headings.',
        '- key_sources must identify the source IDs or URLs most worth citing.',
        '- section_briefs.source_focus and must_use_sources should prefer concrete source IDs such as S1/S2 from evidence_cards.',
        '- Do not author the 参考来源 / 图片来源 / 一句话结论 tail blocks; the program appends them.',
        '- cover_brief must be a short content-only visual clue; do not prescribe medium, palette, composition, brand motifs, or negative prompts.',
      ].join('\n')
    : [
        'You are planning a Chinese AI daily brief with one clear thesis.',
        'Return JSON with keys:',
        'topic, thesis, keywords, arxiv_queries, outline, section_briefs, evidence_cards, counterpoints, reader_question, image_sections, key_sources, tags, cover_brief',
        'Requirements:',
        '- Focus on one topic rather than a loose news digest.',
        '- The outline must use the exact required section headings provided by the format profile.',
        '- section_briefs is required. Each item must have heading, goal, angle, key_points, must_use_sources, evidence_cards, source_focus, suggested_subheads, counterpoint, style_constraints, avoid.',
        '- evidence_cards should select the strongest available source IDs and explain what each card supports, its caveat, and which sections should use it.',
        '- counterpoints must list 1 to 3 plausible objections, uncertainty points, or ways the thesis could be wrong.',
        '- reader_question should state the concrete question this article answers for readers.',
        '- Add 3 to 6 third-level subheadings across the middle and later sections.',
        '- image_sections can include at most 3 section headings.',
        '- key_sources must identify the source IDs or URLs most worth citing.',
        '- section_briefs.source_focus and must_use_sources should prefer concrete source IDs such as S1/S2 from evidence_cards.',
        '- cover_brief must be a short content-only visual clue; do not prescribe medium, palette, composition, brand motifs, or negative prompts.',
      ].join('\n')

  const user = [
    `Date: ${today}`,
    `Workflow content type: ${workflow?.content_type || 'daily_brief'}`,
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
    '',
    'Research pack:',
    stringifyPromptPayload(researchPackForPrompt(researchPack), isWeeklyReview ? 22000 : 14000),
  ].join('\n')

  return callLLM(system, user, 8192, {
    validate: (payload) => validateOutlinePayload(payload, { isFreeStructure }),
  })
}

async function generateWeeklyReviewPackage({ outline, researchPack, formatProfile, workflow, today }) {
  const system = [
    'You are preparing the metadata package for a premium Chinese weekly AI review.',
    'Return only JSON with keys: title, slug, summary, tags, takeaway.',
    `slug must be exactly ${workflow.slug}.`,
    'The title must sound like a weekly strategic review, not a daily brief.',
    'The summary must be concise but more forceful than a news summary.',
    'The takeaway must be one judgment-led sentence.',
    'Write all fields in Simplified Chinese except tags.',
  ].join('\n')

  const user = [
    `Date: ${today}`,
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
    '',
    'Outline:',
    stringifyPromptPayload(outline, 8000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildWeeklyResearchDigest(researchPack, 14), 12000),
  ].join('\n')

  return callLLM(system, user, 2048, { validate: validateArticlePackagePayload })
}

async function generateWeeklyReviewSection({
  heading,
  brief,
  outline,
  researchPack,
  formatProfile,
  workflow,
  today,
  targetChars,
}) {
  const markerHints = (formatProfile.analysis_markers || []).slice(0, 8).join(' / ')
  const system = [
    'You are writing one chapter of a long-form Chinese weekly AI review.',
    'Return only JSON with one key: markdown.',
    `The section must start with the exact heading: ${heading}`,
    `Target length for this section: about ${targetChars} Chinese characters.`,
    'Write in Simplified Chinese.',
    'Use at least 4 substantial paragraphs.',
    `Include at least 2 explicit analytical turns, preferably using phrases such as ${markerHints}.`,
    'Where useful, add 1 to 3 third-level subheadings using Markdown ###.',
    'Use source IDs from the research digest/evidence cards for factual claims, for example [S1] or [S2].',
    'Use at least 1 source ID in this section, and never invent source IDs that are not present in the research pack.',
    'Do not output references, image sources, or a takeaway block.',
    'Do not repeat the whole article introduction in every section.',
    'Keep facts attributable and make analytical claims explicit.',
  ].join('\n')

  const user = [
    `Date: ${today}`,
    `Weekly topic: ${outline.topic || ''}`,
    `Weekly thesis: ${outline.thesis || ''}`,
    `Workflow slug: ${workflow.slug}`,
    '',
    'Section brief:',
    stringifyPromptPayload({
      heading,
      goal: brief.goal,
      key_points: brief.key_points,
      source_focus: brief.source_focus,
      suggested_subheads: brief.suggested_subheads,
      weekly_axes: outline.weekly_axes || [],
      watchlist: outline.watchlist || [],
    }, 6000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildWeeklyResearchDigest(researchPack, 18), 18000),
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
  ].join('\n')

  // Weekly sections used to be returned as the raw LLM object and consumed field-by-field
  // by the caller, so a heading the model reworded (an extra space, a different 顿号) no
  // longer matched `extractArticleSections` and the repair path could blank the article.
  // Normalize here exactly like the daily path already does.
  const result = await callLLM(system, user, 6144, { validate: validateSectionPayload })
  return ensureSectionHeading(readSectionMarkdown(result), heading)
}

async function generateDailyArticlePackage({ outline, researchPack, formatProfile, workflow, today }) {
  const system = [
    'You are preparing the metadata package for a Chinese single-topic AI editorial brief.',
    'Return only JSON with keys: title, slug, summary, tags, takeaway.',
    `slug must be exactly ${workflow.slug}.`,
    'The title must express a judgment, tension, or meaningful change rather than repeat a news headline.',
    'The summary must be one concise paragraph in Simplified Chinese and must not start with 本文将 or 这篇文章.',
    'The takeaway must be one concrete judgment-led sentence, not a generic conclusion.',
  ].join('\n')

  const user = [
    `Date: ${today}`,
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
    '',
    'Outline and editorial plan:',
    stringifyPromptPayload(outline, 9000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildDailyResearchDigest(researchPack, 14), 14000),
  ].join('\n')

  return callLLM(system, user, 2048, { validate: validateArticlePackagePayload })
}

async function generateDailyArticleSection({
  heading,
  brief,
  outline,
  researchPack,
  formatProfile,
  workflow,
  today,
  targetChars,
}) {
  const markerHints = (formatProfile.analysis_markers || []).slice(0, 8).join(' / ')
  const dimensionHint = String(brief?.dimension || '').trim()
  const system = [
    'You are writing one section of a Chinese AI/technology editorial brief.',
    'Return only JSON with one key: markdown.',
    `The section must start with the exact heading: ${heading}`,
    `Target length for this section: about ${targetChars} Chinese characters.`,
    'Write in Simplified Chinese.',
    'Use at least 2 substantial paragraphs; important sections may use 3 to 4 paragraphs.',
    'Where useful, add 1 Markdown ### subheading, especially for analysis-heavy sections.',
    `Include explicit analytical turns using phrases such as ${markerHints}, but do not force them mechanically.`,
    'Use source IDs from the research digest/evidence cards for factual claims, for example [S1] or [S2].',
    'Use the section brief as an editorial contract: goal, angle, key points, counterpoint, and avoid rules matter.',
    ...(dimensionHint
      ? [`This section primarily carries the "${dimensionHint}" editorial dimension; make sure that responsibility is clearly fulfilled here.`]
      : []),
    'Clearly separate facts, inference, and author judgment.',
    'Include trade-off, stakeholder impact, uncertainty, or second-order consequence when relevant.',
    'Do not output references, image sources, a takeaway block, frontmatter, MDX, cover prompts, or custom components.',
    'Do not repeat the whole article introduction in every section.',
  ].join('\n')

  const user = [
    `Date: ${today}`,
    `Topic: ${outline.topic || ''}`,
    `Thesis: ${outline.thesis || ''}`,
    `Reader question: ${outline.reader_question || ''}`,
    `Workflow slug: ${workflow.slug}`,
    '',
    'Section brief:',
    stringifyPromptPayload({
      heading,
      dimension: brief.dimension,
      goal: brief.goal,
      angle: brief.angle,
      key_points: brief.key_points,
      must_use_sources: brief.must_use_sources,
      evidence_cards: brief.evidence_cards,
      source_focus: brief.source_focus,
      suggested_subheads: brief.suggested_subheads,
      counterpoint: brief.counterpoint,
      style_constraints: brief.style_constraints,
      avoid: brief.avoid,
      article_counterpoints: outline.counterpoints || [],
    }, 8000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildDailyResearchDigest(researchPack, 16), 18000),
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
  ].join('\n')

  const result = await callLLM(system, user, 6144, { validate: validateSectionPayload })
  return ensureSectionHeading(readSectionMarkdown(result), heading)
}

async function generateDailyArticleFromSections({ outline, researchPack, formatProfile, workflow, today }) {
  const packageData = await generateDailyArticlePackage({
    outline,
    researchPack,
    formatProfile,
    workflow,
    today,
  })
  const sectionBriefs = normalizeSectionBriefs(outline, formatProfile)
  const sectionTargetChars = Number(workflow.section_target_chars || 850)
  const renderedSections = []

  for (const brief of sectionBriefs) {
    renderedSections.push(await generateDailyArticleSection({
      heading: brief.heading,
      brief,
      outline,
      researchPack,
      formatProfile,
      workflow,
      today,
      targetChars: sectionTargetChars,
    }))
  }

  return {
    title: packageData.title,
    slug: workflow.slug,
    summary: packageData.summary,
    tags: packageData.tags,
    takeaway: packageData.takeaway,
    content_md: renderedSections.filter(Boolean).join('\n\n'),
  }
}

async function generateArticleForWorkflow({ outline, researchPack, formatProfile, workflow, today }) {
  if (!isWeeklyReviewWorkflow(workflow, formatProfile)) {
    return generateDailyArticleFromSections({ outline, researchPack, formatProfile, workflow, today })
  }

  const packageData = await generateWeeklyReviewPackage({
    outline,
    researchPack,
    formatProfile,
    workflow,
    today,
  })
  const sectionBriefs = normalizeSectionBriefs(outline, formatProfile)
  const sectionTargetChars = Number(workflow.section_target_chars || 1900)
  const renderedSections = []

  for (const brief of sectionBriefs) {
    // generateWeeklyReviewSection now returns heading-normalized Markdown, so the heading
    // in the article always matches the heading the gate and the repair path look for.
    renderedSections.push(await generateWeeklyReviewSection({
      heading: brief.heading,
      brief,
      outline,
      researchPack,
      formatProfile,
      workflow,
      today,
      targetChars: sectionTargetChars,
    }))
  }

  return {
    title: packageData.title,
    slug: workflow.slug,
    summary: packageData.summary,
    tags: packageData.tags,
    takeaway: packageData.takeaway,
    content_md: renderedSections.filter(Boolean).join('\n\n'),
  }
}

async function repairWeeklyReviewSection({
  heading,
  brief,
  currentMarkdown,
  outline,
  researchPack,
  formatProfile,
  workflow,
  today,
  targetChars,
  minParagraphs = 4,
  attempt,
  failures = [],
}) {
  const markerHints = (formatProfile.analysis_markers || []).slice(0, 8).join(' / ')
  const paragraphFloor = Math.max(4, Number(minParagraphs) || 0)
  const system = [
    'You are expanding one section of a Chinese weekly AI review after a quality-gate failure.',
    'Return only JSON with one key: markdown.',
    `The section must start with the exact heading: ${heading}`,
    `Expand this section so it approaches ${targetChars} Chinese characters on its own.`,
    'Preserve the current factual basis and thesis, but make the section deeper, broader, and more analytical.',
    `Write at least ${paragraphFloor} substantial body paragraphs. Each paragraph must be plain prose separated from the next by a blank line.`,
    'A bullet list, numbered list, or single long block does NOT count as multiple paragraphs — use real prose paragraphs separated by blank lines.',
    `Include at least 2 explicit analytical turns, preferably using phrases such as ${markerHints}.`,
    'Use provided source IDs such as [S1] for factual claims; do not invent source IDs.',
    'You may add 1 to 2 Markdown ### subheadings if they improve structure, but they do not replace the paragraph requirement.',
    'Do not output references, image sources, or article-level conclusions.',
  ].join('\n')

  const user = [
    `Repair attempt: ${attempt}`,
    `Date: ${today}`,
    '',
    'Quality gate failures relevant to this repair:',
    ...failures.map((reason) => `- ${reason}`),
    '',
    'Current section markdown:',
    smartTruncate(String(currentMarkdown || ''), 8000),
    '',
    'Section brief:',
    stringifyPromptPayload({
      heading,
      goal: brief.goal,
      key_points: brief.key_points,
      source_focus: brief.source_focus,
      suggested_subheads: brief.suggested_subheads,
      weekly_axes: outline.weekly_axes || [],
      watchlist: outline.watchlist || [],
    }, 6000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildWeeklyResearchDigest(researchPack, 18), 16000),
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
  ].join('\n')

  const result = await callLLM(system, user, 6144, { validate: validateSectionPayload })
  return ensureSectionHeading(readSectionMarkdown(result), heading)
}

async function repairWeeklyReviewArticle({
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
  const gateProfile = resolveGateProfile(config, workflow?.content_type)
  const requiredSections = formatProfile.required_sections || []
  const currentSections = extractArticleSections(post.content_md, requiredSections)
  const sectionBriefs = normalizeSectionBriefs(outline, formatProfile)
  const minSectionChars = Math.max(
    1100,
    Math.floor((gateProfile.min_chars || 8500) / Math.max(1, requiredSections.length))
  )
  const targetSectionChars = Math.max(
    Number(workflow.section_target_chars || 1600),
    minSectionChars + 250
  )
  const needsAnalysisBoost = gate.reasons.some((reason) => reason.startsWith('analysis_signals:'))
  // Sections the gate named explicitly (thin_sections / section_paragraphs / section_citations /
  // missing_sections all embed the offending heading). These must be repaired even when their
  // char count already clears minSectionChars — otherwise a paragraph-count or citation failure
  // loops forever because char-based selection never picks them.
  const reasonHeadings = headingsFromGateReasons(gate.reasons, requiredSections)
  const minSectionParagraphs = Math.max(0, Number(gateProfile.min_section_paragraphs || 0))
  const candidates = sectionBriefs.map((brief) => {
    const markdown = currentSections.get(brief.heading) || `${brief.heading}\n\n`
    const charCount = stripMarkdownForLength(markdown).length
    const targeted = reasonHeadings.has(brief.heading)
    return { brief, markdown, charCount, targeted }
  })

  let sectionsToRepair = candidates.filter((candidate) => candidate.targeted || candidate.charCount < minSectionChars)
  if (sectionsToRepair.length === 0 && (needsAnalysisBoost || gate.reasons.some((reason) => reason.startsWith('chars:')))) {
    sectionsToRepair = [...candidates].sort((left, right) => left.charCount - right.charCount).slice(0, 4)
  } else {
    // Keep targeted sections first, then fill remaining slots with the shortest sections.
    sectionsToRepair = [...sectionsToRepair]
      .sort((left, right) => (Number(right.targeted) - Number(left.targeted)) || (left.charCount - right.charCount))
      .slice(0, 4)
  }

  // Only the chapters we actually rewrite go into the map; everything else is preserved
  // untouched by the splice below (including the article lede before the first heading).
  const repairedSections = new Map()
  for (const candidate of sectionsToRepair) {
    const repairedMarkdown = await repairWeeklyReviewSection({
      heading: candidate.brief.heading,
      brief: candidate.brief,
      currentMarkdown: candidate.markdown,
      outline,
      researchPack,
      formatProfile,
      workflow,
      today,
      targetChars: targetSectionChars,
      minParagraphs: minSectionParagraphs,
      attempt,
      failures: gate.reasons,
    })
    repairedSections.set(candidate.brief.heading, repairedMarkdown)
  }

  return {
    ...post,
    slug: workflow.slug,
    content_md: spliceRepairedSections(post.content_md, requiredSections, repairedSections),
  }
}

function canRepairQualityGate(gate) {
  const nonRepairablePrefixes = [
    'sources:',
    'high_quality_sources:',
    'cited_domains:',
    'invalid_citations:',
  ]
  const repairablePrefixes = [
    'chars:',
    'analysis_signals:',
    'missing_sections:',
    'banned_phrases:',
    'citations:',
    'cited_sources:',
    'section_citations:',
    'thin_sections:',
    'section_paragraphs:',
    'subheadings:',
    'body_source_mentions:',
    'analysis_sections:',
    'short_paragraph_ratio:',
    'section_char_ratio:',
    'list_only_sections:',
    'repeated_lines:',
    'missing_dimensions:',
    'section_count:',
  ]

  return gate.reasons.length > 0
    && gate.reasons.every((reason) => !nonRepairablePrefixes.some((prefix) => reason.startsWith(prefix)))
    && gate.reasons.every((reason) => repairablePrefixes.some((prefix) => reason.startsWith(prefix)))
}

function headingsFromGateReasons(reasons = [], requiredSections = []) {
  const matched = new Set()
  for (const reason of reasons) {
    for (const heading of requiredSections) {
      if (String(reason || '').includes(heading)) matched.add(heading)
    }
  }
  return matched
}

async function repairDailyArticleSection({
  heading,
  brief,
  currentMarkdown,
  outline,
  researchPack,
  formatProfile,
  workflow,
  today,
  targetChars,
  attempt,
  failures = [],
}) {
  const markerHints = (formatProfile.analysis_markers || []).slice(0, 8).join(' / ')
  const system = [
    'You are repairing one section of a Chinese AI/technology editorial brief after a quality-gate failure.',
    'Return only JSON with one key: markdown.',
    `The section must start with the exact heading: ${heading}`,
    `Repair this section so it approaches ${targetChars} Chinese characters on its own.`,
    'Keep the same topic and thesis, but make the section more grounded, analytical, and complete.',
    'Use at least 2 substantial paragraphs; add a Markdown ### subheading if it improves structure.',
    `Add explicit analytical turns using phrases such as ${markerHints}, but keep the writing natural.`,
    'Use provided source IDs such as [S1] for factual claims; do not invent source IDs.',
    'If the failure mentions citations or source mentions, add source-grounded claims inside the section body.',
    'If the failure mentions short paragraphs or thin sections, add evidence, caveats, trade-offs, and second-order consequences instead of filler.',
    'Do not output references, image sources, article-level conclusion, frontmatter, MDX, or cover prompts.',
  ].join('\n')

  const user = [
    `Repair attempt: ${attempt}`,
    `Date: ${today}`,
    '',
    'Quality gate failures relevant to this repair:',
    ...failures.map((reason) => `- ${reason}`),
    '',
    'Current section markdown:',
    smartTruncate(String(currentMarkdown || ''), 8000),
    '',
    'Section brief:',
    stringifyPromptPayload({
      heading,
      goal: brief.goal,
      angle: brief.angle,
      key_points: brief.key_points,
      must_use_sources: brief.must_use_sources,
      evidence_cards: brief.evidence_cards,
      source_focus: brief.source_focus,
      suggested_subheads: brief.suggested_subheads,
      counterpoint: brief.counterpoint,
      style_constraints: brief.style_constraints,
      avoid: brief.avoid,
      article_counterpoints: outline.counterpoints || [],
    }, 8000),
    '',
    'Research digest:',
    stringifyPromptPayload(buildDailyResearchDigest(researchPack, 16), 18000),
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
  ].join('\n')

  const result = await callLLM(system, user, 6144, { validate: validateSectionPayload })
  return ensureSectionHeading(readSectionMarkdown(result), heading)
}

async function repairDailyArticle({
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
  const gateProfile = resolveGateProfile(config, workflow?.content_type)
  const isFreeStructure = formatProfile.structure_mode === 'free'
  const sectionBriefs = normalizeSectionBriefs(outline, formatProfile)
  // Free mode: the canonical heading list is whatever the LLM authored (carried by the
  // briefs), not a fixed template. Fixed mode: the required template headings, unchanged.
  const sectionHeadings = isFreeStructure
    ? sectionBriefs.map((brief) => brief.heading).filter(Boolean)
    : (formatProfile.required_sections || [])
  const currentSections = extractArticleSections(post.content_md, sectionHeadings)
  const reasonHeadings = headingsFromGateReasons(gate.reasons, sectionHeadings)
  // Free mode: map an uncovered dimension back to the chapters that were supposed to carry
  // it (via brief.dimension), so a missing_dimensions failure repairs the right sections.
  const missingDimensions = isFreeStructure
    ? (gate.reasons
        .find((reason) => reason.startsWith('missing_dimensions:')) || '')
      .replace('missing_dimensions:', '')
      .split('|')
      .filter(Boolean)
    : []
  const dimensionHeadings = new Set(
    isFreeStructure && missingDimensions.length > 0
      ? sectionBriefs
        .filter((brief) => missingDimensions.includes(String(brief.dimension || '')))
        .map((brief) => brief.heading)
      : []
  )
  const minSectionChars = Math.max(550, Number(gateProfile.min_section_chars || 0))
  const targetSectionChars = Math.max(Number(workflow.section_target_chars || 850), minSectionChars + 250)
  const needsGlobalBoost = gate.reasons.some((reason) => (
    reason.startsWith('chars:')
    || reason.startsWith('analysis_signals:')
    || reason.startsWith('subheadings:')
    || reason.startsWith('body_source_mentions:')
    || reason.startsWith('analysis_sections:')
    || reason.startsWith('short_paragraph_ratio:')
    || reason.startsWith('missing_dimensions:')
  ))
  const candidates = sectionBriefs.map((brief) => {
    const markdown = currentSections.get(brief.heading) || `${brief.heading}\n\n`
    const charCount = stripMarkdownForLength(markdown).length
    const targeted = reasonHeadings.has(brief.heading) || dimensionHeadings.has(brief.heading)
    return { brief, markdown, charCount, targeted }
  })

  let sectionsToRepair = candidates.filter((candidate) => candidate.targeted || candidate.charCount < minSectionChars)
  if (sectionsToRepair.length === 0 && needsGlobalBoost) {
    sectionsToRepair = [...candidates].sort((left, right) => left.charCount - right.charCount).slice(0, 3)
  } else {
    sectionsToRepair = [...sectionsToRepair].sort((left, right) => left.charCount - right.charCount).slice(0, 3)
  }

  const repairedSections = new Map()
  for (const candidate of sectionsToRepair) {
    const repairedMarkdown = await repairDailyArticleSection({
      heading: candidate.brief.heading,
      brief: candidate.brief,
      currentMarkdown: candidate.markdown,
      outline,
      researchPack,
      formatProfile,
      workflow,
      today,
      targetChars: targetSectionChars,
      attempt,
      failures: gate.reasons,
    })
    repairedSections.set(candidate.brief.heading, repairedMarkdown)
  }

  return {
    ...post,
    slug: workflow.slug,
    content_md: spliceRepairedSections(post.content_md, sectionHeadings, repairedSections),
  }
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
  if (workflow?.content_type === 'weekly_review') {
    return repairWeeklyReviewArticle({
      post,
      outline,
      researchPack,
      formatProfile,
      workflow,
      config,
      today,
      gate,
      attempt,
    })
  }

  return repairDailyArticle({
    post,
    outline,
    researchPack,
    formatProfile,
    workflow,
    config,
    today,
    gate,
    attempt,
  })
}

function buildCoverGenerationResult({
  ok = false,
  imageUrl = '',
  errorCode = '',
  error = '',
  sourceUrl = '',
} = {}) {
  return {
    ok,
    imageUrl: imageUrl || '',
    errorCode: errorCode || '',
    error: error || '',
    sourceUrl: sourceUrl || '',
  }
}

function logCoverGenerationResult(context, result) {
  if (!result) return
  if (result.ok && result.imageUrl) {
    console.log(`${context} generated successfully: ${result.imageUrl}`)
    return
  }
  const code = result.errorCode || 'unknown_error'
  const message = result.error || 'Unknown cover generation failure.'
  console.warn(`${context} skipped: [${code}] ${message}`)
}

async function generatePostCoverWithAdminApi(postId, coverBrief, token) {
  try {
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: BLOG_API_BASE,
      token,
      postId,
      coverBrief,
      overwrite: false,
    })
    const imageUrl = imageGenerationJobImageUrl(job)
    return buildCoverGenerationResult({
      ok: imageGenerationJobSucceeded(job),
      imageUrl,
      errorCode: job.error_code || (imageUrl ? '' : 'generation_failed'),
      error: job.error || (imageUrl ? '' : '生图任务未返回可用图片地址。'),
      sourceUrl: `admin-image-generation-job:${job.job_id || job.id || ''}`,
    })
  } catch (error) {
    return buildCoverGenerationResult({
      ok: false,
      errorCode: 'generation_failed',
      error: error?.message || '管理端生图任务提交失败。',
    })
  }
}

function createAdminLoginError(status) {
  const error = new Error(`Admin login failed: ${status}`)
  error.status = status
  return error
}

// `POST /api/admin/login` is rate limited to 5/minute on the backend, so two overlapping
// workflows trivially collide and get a 429. 429 was in no retry predicate at all, so the
// collision killed the whole run instantly.
export function isRetryableHttpStatus(status) {
  const code = Number(status || 0)
  return code === 408 || code === 429 || code >= 500
}

// `Retry-After` is either delta-seconds or an HTTP-date; honour both, clamped so a hostile
// or absurd value cannot stall the run.
export function parseRetryAfterMs(value, { maxMs = 120000 } = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.min(maxMs, Number(raw) * 1000)
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) return 0
  return Math.min(maxMs, Math.max(0, timestamp - Date.now()))
}

function isRetryableAdminLoginError(error) {
  const status = Number(error?.status || 0)
  if (status) return isRetryableHttpStatus(status)

  const code = String(error?.code || '')
  const message = String(error?.message || '')
  return error?.name === 'AbortError'
    || error?.name === 'TimeoutError'
    || /timeout|aborted|network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(`${code} ${message}`)
}

export async function loginAdminWithRetry({
  blogApiBase = BLOG_API_BASE,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
  fetchImpl = fetch,
  timeoutMs = 30000,
  retryDelaysMs = [10000, 30000, 60000],
  sleepImpl = sleep,
  logger = console,
} = {}) {
  const attempts = retryDelaysMs.length + 1
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resp = await fetchImpl(`${blogApiBase}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!resp.ok) throw createAdminLoginError(resp.status)

      const payload = await resp.json()
      const token = String(payload?.access_token || '').trim()
      if (!token) throw new Error('Admin login failed: missing access_token')
      return token
    } catch (error) {
      lastError = error
      if (!isRetryableAdminLoginError(error) || attempt >= attempts) break

      const delayMs = retryDelaysMs[attempt - 1]
      logger?.warn?.(`Admin login attempt ${attempt}/${attempts} failed (${error?.message || 'unknown error'}); retrying in ${Math.round(delayMs / 1000)}s...`)
      await sleepImpl(delayMs)
    }
  }

  throw lastError || new Error('Admin login failed')
}

async function getAdminToken() {
  return loginAdminWithRetry()
}

async function checkSlugExists(slug) {
  try {
    return (await fetch(`${BLOG_API_BASE}/api/posts/${slug}`, {
      signal: AbortSignal.timeout(10000),
    })).ok
  } catch {
    return false
  }
}

async function fetchExistingPost(slug, token = '', fetchImpl = fetch) {
  if (token) {
    return findAdminPostByExactSlug({
      blogApiBase: BLOG_API_BASE,
      token,
      slug,
      fetchImpl,
    })
  }
  try {
    const resp = await fetchImpl(`${BLOG_API_BASE}/api/posts/${slug}`, {
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

function truncateSummary(summary, max = 50) {
  const chars = Array.from(String(summary || '').trim())
  return chars.length <= max ? chars.join('') : chars.slice(0, max).join('')
}

function extractSourceCitationIds(contentMd) {
  const ids = new Set()
  const regex = /\[(S\d+)\]/g
  let match = regex.exec(String(contentMd || ''))
  while (match) {
    ids.add(match[1])
    match = regex.exec(String(contentMd || ''))
  }
  return ids
}

function buildSourceMap(researchPack = {}) {
  return new Map((researchPack.sources || [])
    .filter((item) => item.source_id)
    .map((item) => [item.source_id, item]))
}

function linkSourceCitations(contentMd, researchPack = {}) {
  const sourceMap = buildSourceMap(researchPack)
  return String(contentMd || '').replace(/\[(S\d+)\](?!\()/g, (full, id) => {
    const source = sourceMap.get(id)
    if (!source?.url) return full
    return `[${id}](${source.url})`
  })
}

function buildReferencesSection(researchPack, citedSourceIds = new Set()) {
  const lines = ['## 参考来源']
  const sourceMap = buildSourceMap(researchPack)
  const citedSources = [...citedSourceIds]
    .map((id) => sourceMap.get(id))
    .filter(Boolean)
  const sources = citedSources.length > 0 ? citedSources : (researchPack.sources || []).slice(0, 12)
  const sourceLines = sources.slice(0, 12).map((item) => {
    const label = `${item.source_id ? `${item.source_id} · ` : ''}${item.source_name} / ${item.source_type}`
    return `- [${item.title}](${item.url}) - ${label}${item.published_at ? ` - ${item.published_at}` : ''}`
  })
  return `${lines.join('\n')}\n\n${sourceLines.join('\n') || '- 无'}`
}

export function buildImageSourcesSection(imagePlans) {
  const lines = ['## 图片来源']
  const body = imagePlans.length > 0
    ? imagePlans.map((plan) => `- ${plan.section_heading}: [${plan.source_name}](${plan.source_page_url})`)
    : ['- 无正文插图']
  return `${lines.join('\n')}\n\n${body.join('\n')}`
}

function buildTakeawaySection(post, outline) {
  const takeaway = normalizeWhitespace(post.takeaway || outline.thesis || post.summary || outline.topic)
  return `## 一句话结论\n\n> ${takeaway}`
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

export function insertImagesIntoContent(contentMd, imagePlans) {
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
  const mainContent = neutralizeBannedPhrases(String(post.content_md || '').trim())
  const linkedContent = linkSourceCitations(mainContent, researchPack)
  const withImages = insertImagesIntoContent(linkedContent, imagePlans)
  const citedSourceIds = extractSourceCitationIds(withImages)
  const sections = [
    withImages,
    buildReferencesSection(researchPack, citedSourceIds),
    buildImageSourcesSection(imagePlans),
    buildTakeawaySection(post, outline),
  ]
  if (metadata) sections.push(buildMetadataComment({
    ...metadata,
    cited_source_ids: [...citedSourceIds],
    source_stats: researchPack.source_stats || null,
  }))
  return sections.join('\n\n')
}

// A topic-scoped failure: it means "this topic cannot be published", not "this run is
// broken". Marking it lets the daily/weekly loop skip the topic and still report the run
// and refresh the frontend for the posts that did succeed.
export function createSkippableTopicError(message, cause = null) {
  const error = new Error(message)
  error.skippableTopic = true
  if (cause) error.cause = cause
  return error
}

export function isSkippableTopicError(error) {
  return Boolean(error?.skippableTopic)
    || String(error?.message || '').startsWith('Quality gate failed after repair attempts:')
}

function normalizeForApi(post, fixedSlug, outline, metadata = {}) {
  if (!post.title || !post.content_md) {
    // Previously a plain Error, which did not match the quality-gate prefix the daily loop
    // checked, so one malformed LLM package aborted the entire run.
    throw createSkippableTopicError('LLM output missing title or content_md')
  }

  const slug = fixedSlug || String(post.slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200) || 'ai-daily-post'

  const title = String(post.title).slice(0, 200)
  const summaryLimit = metadata.content_type === 'weekly_review' ? 110 : 50
  let summary = truncateSummary(post.summary || '', summaryLimit)
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

// A full article is the most expensive artifact in the run (all LLM cost is already
// sunk by the time we publish). A transient 5xx/timeout/network blip on the final
// publish call must not discard it, so the request is retried with backoff. Client
// errors (4xx) are deterministic — retrying them only wastes time — so they throw
// immediately. 409 is handled by the caller as an existing-slug conflict, not here.
export async function sendPublishRequest({
  url,
  method,
  requestBody,
  token,
  label = 'Publish',
  fetchImpl = fetch,
  sleepImpl = sleep,
  retryDelaysMs = [2000, 8000, 20000],
  logger = console,
  timeoutMs = 30000,
} = {}) {
  const attempts = retryDelaysMs.length + 1
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryAfterMs = 0
    try {
      const resp = await fetchImpl(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (resp.ok) return { ok: true, status: resp.status, json: await resp.json() }

      // 409 is a meaningful signal for the caller; surface it without retrying.
      if (resp.status === 409) return { ok: false, status: 409, json: null }

      retryAfterMs = parseRetryAfterMs(resp.headers?.get?.('retry-after'))
      const detail = (await resp.text()).slice(0, 300)
      // 5xx/408/429 are transient and worth retrying; other 4xx are deterministic.
      if (!isRetryableHttpStatus(resp.status) || attempt >= attempts) {
        throw new Error(`${label} failed: ${resp.status} ${detail}`)
      }
      lastError = new Error(`${label} failed: ${resp.status} ${detail}`)
    } catch (error) {
      lastError = error
      const retryable = isRetryableAdminLoginError(error)
        || /failed:\s*(408|429|5\d\d)\b/.test(String(error?.message || ''))
      if (!retryable || attempt >= attempts) throw error
    }

    const delayMs = Math.max(retryDelaysMs[attempt - 1], retryAfterMs)
    logger?.warn?.(`${label} attempt ${attempt}/${attempts} failed (${lastError?.message || 'unknown error'}); retrying in ${Math.round(delayMs / 1000)}s...`)
    await sleepImpl(delayMs)
  }

  throw lastError || new Error(`${label} failed`)
}

export async function publishPost(token, payload, coverImage = null, {
  isPublished = true,
  fetchImpl = fetch,
} = {}) {
  const requestBody = {
    title: payload.title,
    slug: payload.slug,
    summary: payload.summary,
    content_md: payload.content_md,
    content_type: payload.content_type,
    topic_key: payload.topic_key,
    published_mode: payload.published_mode,
    coverage_date: payload.coverage_date,
    tags: payload.tags,
    is_published: Boolean(isPublished),
    is_pinned: false,
  }
  if (coverImage !== null && coverImage !== undefined) {
    requestBody.cover_image = coverImage
  }

  const existingPost = await fetchExistingPost(payload.slug, token, fetchImpl)
  if (existingPost?.id) {
    // A successful rerun must not take an already-public article offline while
    // the metadata bridges are being refreshed. Keep the existing version live;
    // the final publish call applies the new content after all bridges succeed.
    if (!isPublished && existingPost.is_published) {
      return existingPost
    }
    const result = await sendPublishRequest({
      url: `${BLOG_API_BASE}/api/admin/posts/${existingPost.id}`,
      method: 'PUT',
      requestBody,
      token,
      label: 'Publish update',
      fetchImpl,
    })
    return result.json
  }

  const result = await sendPublishRequest({
    url: `${BLOG_API_BASE}/api/admin/posts`,
    method: 'POST',
    requestBody,
    token,
    label: 'Publish',
    fetchImpl,
  })

  if (result.status === 409) {
    const conflictPost = await fetchExistingPost(payload.slug, token, fetchImpl)
    if (conflictPost?.id) {
      const retryResult = await sendPublishRequest({
        url: `${BLOG_API_BASE}/api/admin/posts/${conflictPost.id}`,
        method: 'PUT',
        requestBody,
        token,
        label: 'Publish conflict-retry',
        fetchImpl,
      })
      return retryResult.json
    }
    throw new Error('Publish failed: 409 conflict but existing post could not be resolved')
  }

  return result.json
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
    signal: AbortSignal.timeout(15000),
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

// All three bridges used to be bare fetches with a 15s timeout and zero retries, while the
// far cheaper publish call had four attempts with backoff. Render cold starts and rolling
// deploys make a 502/timeout inside 15s ordinary, and a bridge failure discarded a fully
// paid-for article. They now share sendPublishRequest's backoff (which also honours 429).
async function sendBridgeRequest({ url, method, body, token, label, fetchImpl = fetch }) {
  const result = await sendPublishRequest({
    url,
    method,
    requestBody: body,
    token,
    label,
    fetchImpl,
    timeoutMs: 30000,
  })
  return result.json
}

async function upsertPublishingMetadata(token, payload) {
  return sendBridgeRequest({
    url: `${BLOG_API_BASE}/api/admin/publishing-metadata`,
    method: 'POST',
    body: payload,
    token,
    label: 'Publishing metadata bridge',
  })
}

export async function bridgePublishingMetadata(token, payload, {
  upsert = upsertPublishingMetadata,
} = {}) {
  if (!token) throw new Error('Publishing metadata bridge failed: missing admin token')
  if (!payload) throw new Error('Publishing metadata bridge failed: missing payload')
  return upsert(token, payload)
}

async function upsertQualitySnapshot(token, payload) {
  if (!token || !payload?.post_id) return null
  const postId = Number(payload.post_id)
  // Verified against backend/app/routers/admin.py: `PUT /posts/{id}/quality` is the only
  // quality write route. `/posts/{id}/quality-snapshot` and `POST /quality-snapshots` do
  // not exist, so probing them only added guaranteed-404 round trips.
  return sendBridgeRequest({
    url: `${BLOG_API_BASE}/api/admin/posts/${postId}/quality`,
    method: 'PUT',
    body: { quality_snapshot: payload.quality_snapshot },
    token,
    label: 'Quality snapshot bridge',
  })
}

export async function bridgeQualitySnapshot(token, payload, {
  upsert = upsertQualitySnapshot,
} = {}) {
  if (!token) throw new Error('Quality snapshot bridge failed: missing admin token')
  if (!payload) throw new Error('Quality snapshot bridge failed: missing payload')
  if (!payload.post_id) throw new Error('Quality snapshot bridge failed: missing post_id')
  return upsert(token, payload)
}

async function upsertTopicMetadata(token, payload) {
  if (!token || !payload?.post_id) return null
  const postId = Number(payload.post_id)
  // `/posts/{id}/topic-profile` and `POST /topic-metadata` are aliases of the same backend
  // handler, so one call to the canonical route is enough.
  return sendBridgeRequest({
    url: `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-metadata`,
    method: 'PUT',
    body: payload,
    token,
    label: 'Topic metadata bridge',
  })
}

export async function bridgeTopicMetadata(token, payload, {
  upsert = upsertTopicMetadata,
} = {}) {
  if (!token) throw new Error('Topic metadata bridge failed: missing admin token')
  if (!payload) throw new Error('Topic metadata bridge failed: missing payload')
  if (!payload.post_id) throw new Error('Topic metadata bridge failed: missing post_id')
  return upsert(token, payload)
}

// Metadata bridges are not a precondition for the article being readable: publishing
// status, quality snapshot and topic profile are all reporting surfaces. Previously a
// single bridge failure threw, leaving the fully-generated article stuck at
// is_published=false with no status row and no cleanup — and the next run could not see
// the draft through the public slug check, so it regenerated (and re-billed) the article.
// Now each bridge is attempted independently, failures degrade to warnings, and the
// reasons are recorded on the publishing artifact's reserved `failure_reason` field.
export async function runPublishingBridges(token, {
  metadataBridgePayload = null,
  qualitySnapshotPayload = null,
  topicMetadataPayload = null,
} = {}, {
  bridgeMetadataImpl = bridgePublishingMetadata,
  bridgeQualityImpl = bridgeQualitySnapshot,
  bridgeTopicImpl = bridgeTopicMetadata,
  logger = console,
} = {}) {
  const steps = [
    ['publishing_metadata', metadataBridgePayload, bridgeMetadataImpl],
    ['quality_snapshot', qualitySnapshotPayload, bridgeQualityImpl],
    ['topic_metadata', topicMetadataPayload, bridgeTopicImpl],
  ]
  const failures = []

  for (const [name, payload, run] of steps) {
    if (!payload) continue
    try {
      await run(token, payload)
    } catch (error) {
      const reason = `${name}:${error?.message || 'unknown error'}`
      failures.push(reason)
      logger?.warn?.(`Metadata bridge degraded (${reason}); the article will still be published.`)
    }
  }

  if (failures.length > 0 && metadataBridgePayload?.publishing_artifact) {
    metadataBridgePayload.publishing_artifact.failure_reason = failures.join(' | ').slice(0, 1000)
  }
  return failures
}

// --- Section ↔ source attribution ---------------------------------------------------------
//
// The picker's only relevance signal used to be "does the section heading appear as a
// substring of the image URL / alt / class". With Chinese headings and English image URLs
// that hit rate is ≈0, so the section term never contributed anything and the ranking
// collapsed onto the candidate's base score — which is how one og:image ended up in five
// articles regardless of what the sections were about.
//
// The article itself already knows the answer: every paragraph carries `[S1]`-style markers
// naming the source it was written from. Handing "this section was written from S2 and S5"
// to the picker turns an unusable string match into an exact join, and it is the one signal
// that is *structurally* correct rather than heuristic.

// `[S1]`, and `[S1](https://…)` after finalizeArticle has linked the markers.
const SOURCE_ID_MARKER_PATTERN = /\[(S\d+)\]/g
// Outline briefs write source hints as bare ids, `S1: 标题` or a prose sentence naming one.
const SOURCE_ID_TOKEN_PATTERN = /\bS(\d+)\b/g

function normalizeSectionLabel(heading) {
  return String(heading || '').replace(/^#{1,6}\s*/, '').trim()
}

// Same tolerance insertImagesIntoContent uses when it looks for the heading to insert under,
// so a section that will receive an image is also a section we can attribute. The LLM
// routinely appends a colon-subtitle to the outline heading it was given.
function sectionLabelMatches(label, target) {
  if (!label || !target) return false
  if (label === target) return true
  return label.startsWith(`${target}：`)
    || label.startsWith(`${target}:`)
    || label.startsWith(`${target} -`)
    || label.startsWith(`${target} `)
}

export function sliceArticleSections(contentMd) {
  const lines = String(contentMd || '').split('\n')
  const marks = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+(.*)$/.exec(lines[index].trim())
    if (match) marks.push({ index, label: match[1].trim() })
  }
  return marks.map((mark, order) => {
    const end = order + 1 < marks.length ? marks[order + 1].index : lines.length
    return { label: mark.label, markdown: lines.slice(mark.index + 1, end).join('\n') }
  })
}

function collectSourceIds(text, pattern) {
  const ids = []
  const seen = new Set()
  const source = String(text || '')
  pattern.lastIndex = 0
  for (const match of source.matchAll(pattern)) {
    const id = `S${match[1].replace(/^S/i, '')}`
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function plainSectionText(markdown, maxChars = 1200) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
}

/**
 * Builds, for each image-target section, the sources that section was actually written from.
 *
 * Body citations are authoritative; the outline brief (`must_use_sources` / `source_focus`)
 * is the fallback for a section the model wrote without markers, and for the pre-generation
 * case where no body exists yet. Ids that do not resolve to a real source are dropped — the
 * model does hallucinate `[S9]` on a 6-source pack, and passing that on would silently point
 * the picker at nothing.
 *
 * Returned shape (keyed by the exact heading string that was passed in `sections`):
 *   { '## 章节': { heading, source_ids: ['S2'], source_urls: ['https://…'], text, origin } }
 */
export function buildSectionSourceAttribution({
  contentMd = '',
  sections = [],
  outline = {},
  researchPack = {},
} = {}) {
  const sourceById = new Map((researchPack?.sources || [])
    .filter((item) => item?.source_id)
    .map((item) => [item.source_id, item]))
  const bodySections = sliceArticleSections(contentMd)
  const briefs = Array.isArray(outline?.section_briefs) ? outline.section_briefs : []

  const attribution = {}
  for (const heading of sections || []) {
    const target = normalizeSectionLabel(heading)
    const body = bodySections.find((section) => sectionLabelMatches(section.label, target))
    const brief = briefs.find((entry) => sectionLabelMatches(normalizeSectionLabel(entry?.heading), target))

    const bodyIds = collectSourceIds(body?.markdown || '', SOURCE_ID_MARKER_PATTERN)
      .filter((id) => sourceById.has(id))
    const briefIds = collectSourceIds(
      [
        ...(Array.isArray(brief?.must_use_sources) ? brief.must_use_sources : []),
        ...(Array.isArray(brief?.source_focus) ? brief.source_focus : []),
        ...(Array.isArray(brief?.evidence_cards) ? brief.evidence_cards : []),
      ].join(' '),
      SOURCE_ID_TOKEN_PATTERN,
    ).filter((id) => sourceById.has(id))

    const sourceIds = bodyIds.length > 0 ? bodyIds : briefIds
    attribution[heading] = {
      heading,
      source_ids: sourceIds,
      source_urls: sourceIds.map((id) => sourceById.get(id)?.url || '').filter(Boolean),
      // The section's own prose. Far richer than the heading alone, and it is the only text
      // that can be compared against a candidate's caption / surrounding paragraph.
      text: plainSectionText(body?.markdown || [
        brief?.goal || '',
        brief?.angle || '',
        ...(Array.isArray(brief?.key_points) ? brief.key_points : []),
      ].join(' ')),
      origin: bodyIds.length > 0 ? 'body_citation' : (briefIds.length > 0 ? 'outline_brief' : 'none'),
    }
  }
  return attribution
}

// --- Layer 3: illustrations harvested from feed bodies and jina markdown -------------------
//
// These candidates never required a source-page fetch — they arrived with the RSS item or
// inside the full text we already pulled — so they survive exactly the failures (JS-rendered
// bodies, paywalls, bot walls, timeouts) that leave the source-page layer empty. They fill
// only sections that got nothing from the picker, so they can add coverage but never displace
// a better-matched in-article image.

// Chinese has no word boundaries, and `[一-鿿]+` swallows a whole 17-character
// heading into one token — the exact bug that made section matching a no-op. Sliding bigrams
// give stable recall without a dictionary, and cost nothing.
function relevanceTokens(value) {
  const text = String(value || '').toLowerCase()
  const tokens = new Set()
  for (const match of text.matchAll(/[a-z][a-z0-9+.#_-]+/g)) {
    const token = match[0]
    if (token.length >= 3 && !DAILY_STOP_WORDS.has(token)) tokens.add(token)
  }
  for (const run of text.match(/[一-鿿]{2,}/g) || []) {
    for (let index = 0; index + 2 <= run.length; index += 1) tokens.add(run.slice(index, index + 2))
  }
  return tokens
}

function relevanceOverlap(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let hits = 0
  for (const token of left) {
    if (right.has(token)) hits += 1
  }
  return hits / Math.min(left.size, right.size)
}

function scoreHarvestedCandidate(candidate, sectionTokens) {
  // The candidate's own words: alt, figcaption and the paragraph it sits in. This is the
  // natural-language description a URL substring match never had.
  const describedTokens = relevanceTokens(
    `${candidate.alt || ''} ${candidate.caption || ''} ${candidate.context || ''}`,
  )
  let score = relevanceOverlap(sectionTokens, describedTokens) * 1.2
  if (candidate.hasCaption) score += 0.2
  if (candidate.inFigure) score += 0.08
  if (candidate.alt) score += 0.04
  if (candidate.width >= 600 || candidate.height >= 300) score += 0.08
  // A feed body / jina markdown image is by construction part of this article, so being able
  // to place it at all is already worth something; without a floor a candidate with no alt
  // and no caption would tie at 0 and ordering would be arbitrary again.
  return Number((score + 0.01).toFixed(4))
}

/**
 * Fills sections that the source-page picker left empty, using the media candidates that came
 * back with the feed item / jina full text.
 *
 * Preference order inside a section: candidates from the sources that section actually cites,
 * then everything else in the topic. Returns the plans plus a per-rule rejection tally so a
 * "why does this post have no images" question is answerable from the log alone.
 */
export function fillSectionsFromHarvestedMedia({
  sections = [],
  existingPlans = [],
  sourceItems = [],
  attribution = {},
  rules = {},
  isExcluded,
  logger = console,
} = {}) {
  const stats = { attempted: 0, candidates: 0, picked: 0, rejected: {}, sources_with_media: 0 }
  const covered = new Set((existingPlans || []).map((plan) => plan.section_heading))
  const pending = (sections || []).filter((heading) => !covered.has(heading))
  // `added` is returned separately from `plans` on purpose: dedupeImagePlansAgainstUsed both
  // filters *and* registers, so re-running it over plans it has already seen would classify
  // them as duplicates of themselves and drop the lot. Callers register only what is new.
  if (pending.length === 0) return { plans: existingPlans || [], added: [], stats }

  const withMedia = (sourceItems || [])
    .map((item) => ({ item, media: Array.isArray(item?.media_candidates) ? item.media_candidates : [] }))
    .filter((entry) => entry.media.length > 0)
  stats.sources_with_media = withMedia.length
  stats.candidates = withMedia.reduce((total, entry) => total + entry.media.length, 0)
  if (withMedia.length === 0) return { plans: existingPlans || [], added: [], stats }

  const takenKeys = new Set((existingPlans || [])
    .map((plan) => normalizeImageUrlForDedupe(plan.image_url))
    .filter(Boolean))
  const reject = (rule) => {
    stats.rejected[rule] = (stats.rejected[rule] || 0) + 1
  }

  const added = []
  for (const heading of pending) {
    stats.attempted += 1
    const context = attribution?.[heading] || {}
    const citedIds = new Set(context.source_ids || [])
    const sectionTokens = relevanceTokens(`${normalizeSectionLabel(heading)} ${context.text || ''}`)

    const ranked = []
    for (const { item, media } of withMedia) {
      const cited = citedIds.size > 0 && citedIds.has(item.source_id)
      for (const candidate of media) {
        const url = String(candidate?.url || '').trim()
        if (!url) continue
        const key = normalizeImageUrlForDedupe(url)
        if (key && takenKeys.has(key)) {
          reject('duplicate_in_article')
          continue
        }
        // Same URL-level rules a source-page candidate is graded with — imported from the
        // picker rather than re-implemented, so the two layers can never drift apart.
        const ruleHit = classifyRejectedImageUrl(url, rules)
        if (ruleHit) {
          reject(ruleHit)
          continue
        }
        if (candidate.width && candidate.width < (rules.min_width || 0)) {
          reject('min_width')
          continue
        }
        if (candidate.height && candidate.height < (rules.min_height || 0)) {
          reject('min_height')
          continue
        }
        if (!isPublicHttpUrl(url)) {
          reject('non_public_url')
          continue
        }
        if (typeof isExcluded === 'function') {
          let excluded = false
          try {
            excluded = Boolean(isExcluded(url))
          } catch {
            excluded = false
          }
          if (excluded) {
            reject('already_published')
            continue
          }
        }
        // A source the section actually cites outranks every uncited one, whatever the text
        // overlap says — the attribution is structural, the overlap is a heuristic.
        ranked.push({
          candidate,
          item,
          cited,
          score: scoreHarvestedCandidate(candidate, sectionTokens) + (cited ? 1 : 0),
        })
      }
    }

    if (ranked.length === 0) continue
    ranked.sort((left, right) => right.score - left.score)
    const best = ranked[0]
    const key = normalizeImageUrlForDedupe(best.candidate.url)
    if (key) takenKeys.add(key)
    stats.picked += 1
    added.push({
      section_heading: heading,
      image_url: best.candidate.url,
      source_page_url: best.item.url,
      source_name: best.item.source_name,
      reason: `${best.cited ? 'harvested_cited_source' : 'harvested_topic_source'}:${best.candidate.origin || 'feed'}`,
      alt_text: best.candidate.alt || best.candidate.caption || best.item.title,
      score: Number(best.score.toFixed(3)),
      layer: 'harvested_media',
      cited_source_ids: [...citedIds],
    })
  }

  if (added.length > 0) {
    logger?.log?.(`Harvested-media fallback supplied ${added.length} illustration(s) for section(s) the source-page picker left empty.`)
  }
  return { plans: [...(existingPlans || []), ...added], added, stats }
}

// --- Coverage report ----------------------------------------------------------------------
//
// "This post shipped with no images" used to be one warn line with no way to tell which layer
// failed. Every layer now reports hits and misses into one object that goes to the run log and
// into the publishing artifact, so the next regression is diagnosable without pulling
// production data by hand and eyeballing it.
export function summarizeImageCoverage({
  desiredSections = [],
  sourceItems = [],
  attribution = {},
  pickedPlans = [],
  afterDedupePlans = [],
  harvestedStats = null,
  afterHarvestPlans = [],
  finalPlans = [],
  aiConfig = {},
  localizedPlans = null,
} = {}) {
  const byLayer = (plans, predicate) => (plans || []).filter(predicate).length
  const covered = new Set((finalPlans || []).map((plan) => plan.section_heading))
  const attributed = Object.values(attribution || {})
  return {
    desired_sections: desiredSections.length,
    covered_sections: covered.size,
    uncovered_sections: desiredSections.filter((heading) => !covered.has(heading)),
    section_attribution: {
      from_body_citation: attributed.filter((entry) => entry.origin === 'body_citation').length,
      from_outline_brief: attributed.filter((entry) => entry.origin === 'outline_brief').length,
      unattributed: attributed.filter((entry) => entry.origin === 'none').length,
    },
    supply: {
      source_pages_offered: sourceItems.length,
      sources_with_harvested_media: harvestedStats?.sources_with_media ?? 0,
      harvested_media_candidates: harvestedStats?.candidates ?? 0,
    },
    layers: {
      source_page: {
        picked: pickedPlans.length,
        dropped_as_duplicate: Math.max(0, pickedPlans.length - afterDedupePlans.length),
      },
      harvested_media: {
        sections_attempted: harvestedStats?.attempted ?? 0,
        picked: harvestedStats?.picked ?? 0,
        rejected: harvestedStats?.rejected ?? {},
      },
      ai_generated: {
        enabled: Boolean(aiConfig.enabled),
        picked: byLayer(finalPlans, (plan) => plan.reason === 'ai_fallback'),
        sections_left_for_ai: Math.max(0, desiredSections.length - afterHarvestPlans.length),
      },
    },
    // Localization runs after the quality gate, so this is filled in on the second pass only.
    localization: localizedPlans === null ? null : {
      planned: finalPlans.length,
      published: localizedPlans.length,
      dropped: Math.max(0, finalPlans.length - localizedPlans.length),
    },
  }
}

export async function fillMissingIllustrations({
  desiredSections,
  existingPlans,
  outline,
  config,
  dryRun = false,
  fetchImpl = fetch,
  waitForJob = waitForImageGenerationJob,
  resolveToken = getCachedAdminToken,
  blogApiBase = BLOG_API_BASE,
}) {
  // Last layer of the fallback ladder, and the only paid one. Every section that still has no
  // plan after the source-page picker and the harvested-media layer can get a synthetic
  // illustration here. Source images stay preferred — they are free and tied to the evidence
  // the section was written from — so this only ever runs on what those layers could not fill.
  if (!config.ai_illustration_enabled) return existingPlans

  const coveredSections = new Set(existingPlans.map((plan) => plan.section_heading))
  let missingSections = desiredSections.filter((heading) => !coveredSections.has(heading))
  if (missingSections.length === 0) return existingPlans

  // Cost control, because this layer bills per image. `max_per_post` caps how many synthetic
  // images one article may buy; `only_when_empty` makes it a true last resort — an article
  // that already got one real illustration does not buy two AI ones to pad the rest.
  const budget = config.ai_illustration_budget || {}
  const maxPerPost = Math.max(0, Number(budget.max_per_post ?? 1))
  if (maxPerPost === 0) return existingPlans
  if (budget.only_when_empty !== false && existingPlans.length > 0) {
    console.log(`Skipping AI illustration fill: the article already has ${existingPlans.length} source-based illustration(s).`)
    return existingPlans
  }
  missingSections = missingSections.slice(0, maxPerPost)

  // This function had no dryRun awareness at all: the moment ai_illustration_enabled is
  // flipped on, a `--dry-run` would have generated and persisted real images.
  if (dryRun) {
    console.log(`Dry run: skipping AI illustration generation for ${missingSections.length} section(s).`)
    return existingPlans
  }

  const token = await resolveToken()
  const generatedPlans = []

  for (const sectionHeading of missingSections) {
    // Build a basic illustration prompt from the section heading and article topic. In a future
    // iteration this could be enriched with section_briefs or outline context, but for now we
    // keep it simple: the heading itself often names the concept the section explains.
    const prompt = `Editorial explanatory illustration for article section: ${sectionHeading}. Topic: ${outline.topic || 'AI technology'}. Style: clean, minimal, modern editorial illustration.`

    try {
      const response = await fetchImpl(`${blogApiBase}/api/admin/illustrations/generate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, aspect: 'landscape' }),
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) {
        console.warn(`Illustration generation failed for ${sectionHeading}: HTTP ${response.status}`)
        continue
      }
      // POST /illustrations/generate now only *enqueues* the job (it used to run the model
      // inline and answer with the finished image). At enqueue time `generated` is false and
      // `image_url` is empty, so the old `result.generated && result.image_url` check silently
      // dropped every illustration — while the backend still generated, paid for and uploaded
      // it, leaving an orphaned R2 object. Poll the job the same way covers do.
      const submitted = await response.json()
      const jobId = imageGenerationJobId(submitted)
      if (!jobId) {
        console.warn(`Illustration generation returned no job id for ${sectionHeading}: ${submitted.error || submitted.error_code || 'unknown error'}`)
        continue
      }
      const job = await waitForJob({
        blogApiBase,
        token,
        jobId,
        initialJob: submitted,
        fetchImpl,
        label: 'Illustration generation',
      })
      const imageUrl = imageGenerationJobImageUrl(job)
      if (imageGenerationJobSucceeded(job)) {
        generatedPlans.push({
          section_heading: sectionHeading,
          image_url: imageUrl,
          source_page_url: '',
          source_name: 'AI Generated',
          reason: 'ai_fallback',
          alt_text: `Illustration for ${sectionHeading}`,
          score: 0,
          layer: 'ai_generated',
          // The backend already generated this image straight into our own R2 bucket, so the
          // URL is first-party. Without this marker localizeImagePlans downloaded it and
          // uploaded it a second time, creating a byte-identical duplicate object in R2 for
          // every AI illustration ever published.
          self_hosted: true,
        })
        console.log(`Generated AI illustration for ${sectionHeading}: ${imageUrl}`)
      } else {
        console.warn(`Illustration generation returned no image for ${sectionHeading}: ${job.error || job.error_code || job.status}`)
      }
    } catch (error) {
      console.warn(`Illustration generation request failed for ${sectionHeading}: ${error.message}`)
    }
  }

  return [...existingPlans, ...generatedPlans]
}

export async function prepareImagePlansForPublication(imagePlans, {
  imageUploadToken = '',
  localize = localizeInlineImagePlans,
  blogApiBase = BLOG_API_BASE,
} = {}) {
  // Dry runs intentionally keep candidate URLs for inspection but never call the
  // upload endpoint. Every real publish path supplies imageUploadToken below.
  if (!imageUploadToken || !Array.isArray(imagePlans) || imagePlans.length === 0) {
    return imagePlans || []
  }
  // Localization exists to pull a *third-party* image into our own bucket. A plan that is
  // already first-party (the AI illustration layer generates straight into R2) would be
  // downloaded from R2 and re-uploaded to R2 under a new key — a duplicate object per image,
  // plus an avoidable failure mode. Pass those through untouched.
  const remote = imagePlans.filter((plan) => !plan?.self_hosted)
  if (remote.length === 0) return imagePlans
  const localized = await localize(remote, {
    token: imageUploadToken,
    blogApiBase,
  })
  if (remote.length === imagePlans.length) return localized
  // Keep the original section order: the plans are inserted into the body by heading, and a
  // reordered list makes the 图片来源 section disagree with the body.
  const byOriginalUrl = new Map((localized || []).map((plan) => [plan.original_image_url || plan.image_url, plan]))
  return imagePlans
    .map((plan) => (plan?.self_hosted ? plan : byOriginalUrl.get(plan.image_url)))
    .filter(Boolean)
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
  imageUploadToken = '',
  dryRun = false,
  usedImages = null,
}) {
  const workflowProfile = workflow || {
    slug: fixedSlug || `ai-brief-${today}`,
    content_type: metadata?.content_type || 'daily_brief',
  }
  // Image-target sections must be real headings in the article. Fixed mode validates against
  // the template's required_sections; free mode validates against the LLM-authored outline.
  const validImageHeadings = formatProfile.structure_mode === 'free'
    ? normalizeOutlineHeadings(outline)
    : (formatProfile.required_sections || [])
  const normalizeImageHeading = (heading) => {
    let value = String(heading || '').trim()
    if (!value) return ''
    if (!value.startsWith('#')) value = `## ${value}`
    return value.replace(/^#{1,6}\s*/, '## ')
  }
  const desiredImageSections = (Array.isArray(outline.image_sections) ? outline.image_sections : [])
    .map(normalizeImageHeading)
    .filter((heading) => validImageHeadings.includes(heading))
    .slice(0, config.image_selection_rules?.max_images || 0)

  // The article is drafted BEFORE illustrations are chosen. That order is the point: the body
  // is what tells us which source each section was actually written from ([S1]-style markers),
  // and that attribution is the only reliable relevance signal the picker can have — matching
  // a Chinese heading against an English image URL never worked. Nothing here is billed twice:
  // the draft was always generated exactly once in this function.
  let generatedPost = await generateArticleForWorkflow({
    outline,
    researchPack,
    formatProfile,
    workflow: workflowProfile,
    today,
  })

  const imageRules = config.image_selection_rules || {}
  const imageSourceItems = applyPrimarySourceHintsToSources(
    researchPack.sources.filter((item) => (
      (imageRules.allowed_source_types || []).includes(item.source_type)
    )),
    outline,
  )
  const sectionAttribution = buildSectionSourceAttribution({
    contentMd: generatedPost.content_md,
    sections: desiredImageSections,
    outline,
    researchPack,
  })

  let pickedPlans = []
  if (config.source_image_picker_enabled && desiredImageSections.length > 0) {
    pickedPlans = await pickSourceImages({
      sections: desiredImageSections,
      topic: outline.topic,
      sourceItems: imageSourceItems,
      // Layer 1 of the fallback ladder: "which sources does THIS section cite". Keyed by the
      // exact heading strings passed in `sections`; each entry is
      // { heading, source_ids: ['S2'], source_urls: [...], text, origin }. `text` is the
      // section's own prose, which is the only natural-language description that can be
      // compared against a candidate's caption / surrounding paragraph.
      sectionAttribution,
      config,
      // Handing the memory to the picker lets it fall through to its next-best candidate for
      // the section instead of losing the illustration entirely. A predicate rather than a raw
      // Set because the comparison key is a normalised rendition-folded form, not the URL.
      // `dedupeImagePlansAgainstUsed` below still enforces the same rule, so this is a quality
      // upgrade rather than a correctness dependency — and the picker must not write back into
      // the registry, or that final pass would see its own selections and drop every plan.
      isImageUrlExcluded: usedImages ? usedImages.has : undefined,
      // Same key function the registry uses, so the picker's within-article dedupe agrees with
      // the cross-article one: two renditions of one photo can no longer fill two sections.
      normalizeUrlForDedupe: normalizeImageUrlForDedupe,
    })
  }

  // Drop illustrations another recent article (or an earlier post of this same run) already
  // uses, before the remaining fallback layers, so a dropped duplicate can still be replaced.
  let imagePlans = dedupeImagePlansAgainstUsed(pickedPlans, usedImages)
  const afterDedupePlans = imagePlans

  // Layer 3: images that arrived with the feed body / jina full text and therefore needed no
  // source-page fetch at all. Only fills sections the picker left empty.
  const harvested = fillSectionsFromHarvestedMedia({
    sections: desiredImageSections,
    existingPlans: imagePlans,
    sourceItems: imageSourceItems,
    attribution: sectionAttribution,
    rules: imageRules,
    isExcluded: usedImages ? usedImages.has : undefined,
  })
  // Harvested picks must join the same cross-post memory, or the next article in this run
  // happily re-uses them. Only the NEW plans go through: dedupeImagePlansAgainstUsed registers
  // what it keeps, so feeding it the already-registered picker plans a second time would make
  // every one of them a duplicate of itself.
  imagePlans = [...imagePlans, ...dedupeImagePlansAgainstUsed(harvested.added, usedImages)]
  const afterHarvestPlans = imagePlans

  // Layer 5, paid and last: synthetic illustrations for whatever is still empty.
  imagePlans = await fillMissingIllustrations({
    desiredSections: desiredImageSections,
    existingPlans: imagePlans,
    outline,
    config,
    dryRun,
  })

  const imageCoverage = summarizeImageCoverage({
    desiredSections: desiredImageSections,
    sourceItems: imageSourceItems,
    attribution: sectionAttribution,
    pickedPlans,
    afterDedupePlans,
    harvestedStats: harvested.stats,
    afterHarvestPlans,
    finalPlans: imagePlans,
    aiConfig: { enabled: Boolean(config.ai_illustration_enabled) },
  })
  // One structured line per post. "Why does this article have no illustrations" used to be
  // unanswerable without pulling the published body out of production and grading it by hand.
  console.log(`Image coverage: ${JSON.stringify(imageCoverage)}`)
  if (desiredImageSections.length > 0 && imagePlans.length === 0) {
    console.warn(`No inline illustration could be sourced for any of ${desiredImageSections.length} target section(s); see the image coverage line above for which layer came up empty.`)
  }

  const gateConfig = config.quality_gate?.[metadata.content_type] || config.quality_gate || {}
  const maxRepairAttempts = Math.max(0, Number(gateConfig.max_repair_attempts ?? 4))
  let postForGate = null
  let gate = null

  for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
    // finalizeArticle deterministically rewrites banned phrases, so by the time the gate
    // runs the count is structurally 0. Capture the pre-rewrite count here and hand it to
    // the gate so the quality score keeps a real (non-constant) banned-phrase signal.
    const rawBannedPhraseHits = countPhraseHits(
      String(generatedPost.content_md || ''),
      formatProfile.banned_phrases || [],
    )
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
      raw_banned_phrase_hits: rawBannedPhraseHits,
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

  // Inline images are downloaded and uploaded to R2 only AFTER the gate accepts the
  // article. Doing it before meant every gate-rejected topic left permanently orphaned,
  // unreferenced objects in the bucket.
  const localizedImagePlans = await prepareImagePlansForPublication(imagePlans, { imageUploadToken })
  imageCoverage.localization = {
    planned: imagePlans.length,
    published: localizedImagePlans.length,
    dropped: Math.max(0, imagePlans.length - localizedImagePlans.length),
  }
  if (imageCoverage.localization.dropped > 0) {
    console.warn(`Image coverage after localization: ${JSON.stringify(imageCoverage.localization)}`)
  }
  const publishContentMd = localizedImagePlans === imagePlans
    ? postForGate.content_md
    : finalizeArticle({
      post: generatedPost,
      outline,
      researchPack,
      imagePlans: localizedImagePlans,
      metadata,
    })

  const normalizedPost = normalizeForApi(
    { ...postForGate, content_md: publishContentMd },
    fixedSlug,
    outline,
    metadata,
  )
  const normalizedOutline = {
    ...outline,
    cover_brief: buildPostCoverBrief(normalizedPost, {
      manualBrief: String(outline?.cover_brief || outline?.cover_prompt || '').trim(),
    }),
  }

  return {
    outline: normalizedOutline,
    researchPack,
    imagePlans: localizedImagePlans,
    imageCoverage,
    gate,
    post: normalizedPost,
  }
}

// Extracted so it can run from `finally`: reporting the run and refreshing the frontend
// must happen whether the loop completed, was cut short by a topic-level failure, or threw.
// Both calls are individually failure-tolerant so nothing here can mask the original error.
async function reportDailyRunOutcome({
  token,
  runtime,
  workflow,
  coverageDate,
  clusteredTopics,
  candidateTopics,
  selection,
  results,
  skippedTopics,
  runFailure = null,
}) {
  try {
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
    // Cross-day skips carry their own reason (which post they overlap with, and by how
    // much); without this map they would all be reported as plain same-day duplicates.
    const skipReasonByKey = new Map(
      (selection?.skipped_topics || [])
        .filter((entry) => entry?.topic_key)
        .map((entry) => [entry.topic_key, entry.reason]),
    )
    const preSkippedTopics = (selection?.skipped_topic_keys || [])
      .filter((topicKey) => !publishedKeys.has(topicKey))
      .map((topicKey) => createTopicSnapshot(
        clusteredTopics.find((topic) => topic.topic_key === topicKey),
        {
          topic_key: topicKey,
          content_type: workflow.content_type,
          reason: skipReasonByKey.get(topicKey) || 'already published for coverage date',
          status: 'skipped',
        }
      ))

    const failureMessage = runFailure ? ` Run aborted: ${String(runFailure.message || runFailure).slice(0, 300)}.` : ''
    const emptyQueue = (selection?.queue || []).length === 0
    const message = emptyQueue && results.length === 0
      ? `No eligible topics to publish for this coverage date.${failureMessage}`
      : results.length > 0
        ? `Published ${results.length} post(s), skipped ${preSkippedTopics.length + skippedTopics.length} topic(s).${failureMessage}`
        : `No posts were published in this run.${failureMessage}`

    await reportPublishingRun(token, {
      workflow_key: runtime.mode.replace('-', '_'),
      external_run_id: process.env.GITHUB_RUN_ID || '',
      run_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
      status: runFailure && results.length === 0 ? 'failed' : (results.length > 0 ? 'success' : 'skipped'),
      coverage_date: coverageDate,
      message,
      candidate_topics: candidateTopics,
      published_topics: publishedTopics,
      skipped_topics: [...preSkippedTopics, ...skippedTopics],
    })

    // The site is SSG-prerendered: without this hook a post that is is_published=true in
    // the database is still invisible to readers.
    if (results.length > 0) {
      await triggerFrontendRefreshSafe({
        source: 'auto-blog',
        mode: runtime.mode,
        coverage_date: coverageDate,
        published_count: results.length,
      })
    }
  } catch (error) {
    console.warn(`Failed to finalize daily run reporting: ${error?.message || error}`)
  }
}

async function runDailyMode(config, cliOptions) {
  const runtime = resolveDailyRuntime(config, cliOptions)
  // Daily used to call this with no limits, so it silently inherited the defaults
  // (enrichLimit 15 / maxReturnItems 30) and `max_candidate_items` never took effect.
  const baseItems = await collectBaseMaterials(config, {
    coverageDate: runtime.coverageDate,
    lookbackHours: runtime.lookbackHours,
    feedLimit: runtime.feedLimit,
    enrichLimit: runtime.enrichLimit,
    maxReturnItems: runtime.maxCandidateItems,
  })
  if (baseItems.length === 0) {
    throw new Error('No usable base research items were collected')
  }

  const coverageDate = runtime.coverageDate
  const formatProfile = createDailyBriefFormatProfile()
  const workflow = getContentWorkflowProfile(config, runtime.mode, coverageDate)
  const clusteredTopics = clusterResearchItemsByTopic(baseItems.slice(0, runtime.maxCandidateItems), {
    similarityThreshold: runtime.clusterSimilarityThreshold,
  })
  const guards = await resolvePublishedTopicGuards(runtime, { coverageDate })
  const selection = selectTopicsForPublishing(clusteredTopics, {
    maxPosts: runtime.maxPosts,
    minSourcesPerTopic: runtime.minSourcesPerTopic,
    publishedTopicKeys: guards.publishedTopicKeys,
    publishedTopicFingerprints: guards.publishedTopicFingerprints,
    overlapThreshold: runtime.crossDayDedupe?.overlapThreshold,
    minSharedSources: runtime.crossDayDedupe?.minSharedSources,
  })
  // Seeded from the guard scan that already ran (no extra request), then mutated by every
  // post of this run so a batch of two never ships the same illustration twice.
  const usedImages = createUsedImageRegistry(guards.usedImageUrls)

  const token = runtime.dryRun ? null : await getCachedAdminToken()
  const candidateTopics = clusteredTopics.map((topic) => createTopicSnapshot(topic, {
    content_type: workflow.content_type,
  }))
  const skippedTopics = []
  const results = []
  const gateProfile = resolveGateProfile(config, workflow.content_type)
  // Everything below runs inside try/finally: a post that reached is_published=true must
  // get its publishing-status row and its Vercel deploy-hook trigger even if a later topic
  // blows up. The site is statically prerendered, so a missed hook means the article that
  // is already live in the database is invisible on the site.
  let runFailure = null

  try {
    if (selection.queue.length === 0) {
      console.log('No eligible topics to publish for this coverage date.')
      return []
    }

    for (const topic of selection.queue) {
      if (results.length >= selection.target_count) break

      try {
        const topicBlogItems = runtime.enableBlogwatcherFallback && config.blogwatcher_enabled
          ? await runBlogwatcher({
            config,
            topicHint: topic.candidate_title,
            maxItems: 6,
            mode: runtime.mode,
            coverageDate,
            lookbackHours: runtime.lookbackHours,
          })
          : []
        let paperItems = []
        let researchPack = buildResearchPack({ baseItems: topic.items, blogItems: topicBlogItems, paperItems })
        let support = assessResearchPackSourceSupport({ researchPack, gateProfile })
        if (!support.passed && config.arxiv_enabled) {
          paperItems = await runDailyArxivSupplement({ config, topic })
          if (paperItems.length > 0) {
            researchPack = buildResearchPack({ baseItems: topic.items, blogItems: topicBlogItems, paperItems })
            support = assessResearchPackSourceSupport({ researchPack, gateProfile })
          }
        }
        if (!support.passed) {
          console.log(`Skipping topic ${topic.topic_key}: insufficient source support (${support.reasons.join(', ')})`)
          skippedTopics.push(createTopicSnapshot(topic, {
            content_type: workflow.content_type,
            published_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
            reason: `insufficient_source_support:${support.reasons.join(',')}`,
            status: 'skipped',
          }))
          continue
        }

        console.log(`Topic ${topic.topic_key} source support: sources=${support.metrics.source_count} domains=${support.metrics.unique_domain_count} high_quality=${support.metrics.high_quality_source_count}`)

        const outline = await chooseTopicDetailed({
          researchPack,
          formatProfile,
          today: coverageDate,
          workflow,
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
            section_target_chars: runtime.sectionTargetChars,
          },
          imageUploadToken: token || '',
          dryRun: runtime.dryRun,
          usedImages,
        })

        const bridgeWorkflowKey = runtime.mode.replace('-', '_')
        const metadataBridgePayload = buildPublishingMetadataBridgePayload({
          postId: null,
          post: artifact.post,
          outline: artifact.outline,
          metadata,
          gate: artifact.gate,
          config,
          researchPack: artifact.researchPack,
          imagePlans: artifact.imagePlans,
          imageCoverage: artifact.imageCoverage || null,
          workflowKey: bridgeWorkflowKey,
          coverageDate,
          candidateTopics: [
            createTopicSnapshot(topic, {
              topic_key: topic.topic_key,
              title: artifact.post.title,
              summary: artifact.post.summary,
              content_type: workflow.content_type,
              published_mode: metadata.published_mode,
              post_slug: artifact.post.slug,
              source_count: artifact.researchPack.sources.length,
              source_names: [...new Set(artifact.researchPack.sources.map((source) => source.source_name).filter(Boolean))],
            }),
          ],
        })
        const qualitySnapshotPayload = buildQualitySnapshotPayload({
          postId: null,
          post: artifact.post,
          outline: artifact.outline,
          metadata,
          gate: artifact.gate,
          config,
          researchPack: artifact.researchPack,
        })
        const topicMetadataPayload = buildTopicMetadataPayload({
          postId: null,
          post: artifact.post,
          outline: artifact.outline,
          metadata,
          gate: artifact.gate,
          researchPack: artifact.researchPack,
          config,
        })

        if (runtime.dryRun) {
          results.push({
            ...artifact,
            cover_image: null,
            publishing_metadata: metadataBridgePayload,
            quality_snapshot: qualitySnapshotPayload,
            topic_metadata: topicMetadataPayload,
          })
          continue
        }

        let result = await publishPost(token, artifact.post, null, { isPublished: false })
        metadataBridgePayload.post_id = Number.isFinite(Number(result?.id)) ? Number(result.id) : null
        qualitySnapshotPayload.post_id = metadataBridgePayload.post_id
        topicMetadataPayload.post_id = metadataBridgePayload.post_id

        let coverImage = ''
        const coverBrief = artifact.outline.cover_brief || artifact.outline.cover_prompt || ''
        if (metadataBridgePayload.post_id && coverBrief) {
          console.log(`Requesting configured cover generation for ${slug}...`)
          const coverResult = await generatePostCoverWithAdminApi(metadataBridgePayload.post_id, coverBrief, token)
          logCoverGenerationResult(`Cover image for ${slug}`, coverResult)
          coverImage = coverResult.ok ? coverResult.imageUrl : ''
        }

        // Bridges are reporting surfaces, not publish preconditions: a failure here degrades
        // to a warning (recorded on publishing_artifact.failure_reason) so the paid-for
        // article still goes live instead of being stranded as an invisible draft.
        const bridgeFailures = await runPublishingBridges(token, {
          metadataBridgePayload,
          qualitySnapshotPayload,
          topicMetadataPayload,
        })
        result = await publishPost(token, artifact.post, null, { isPublished: true })
        console.log(`Published daily brief: id=${result.id} slug=${artifact.post.slug}`)
        results.push({
          ...artifact,
          result,
          cover_image: coverImage || null,
          post: coverImage ? { ...artifact.post, cover_image: coverImage } : artifact.post,
          publishing_metadata: metadataBridgePayload,
          quality_snapshot: qualitySnapshotPayload,
          topic_metadata: topicMetadataPayload,
          bridge_failures: bridgeFailures,
        })
      } catch (error) {
        // One bad topic must not abort the run. Anything thrown here (LLM shape failure,
        // bridge outage, publish 4xx, arXiv/blogwatcher error) is recorded against the topic
        // and the loop moves on; already-published posts keep their status report and their
        // frontend refresh.
        const reason = isSkippableTopicError(error)
          ? `quality_gate_failed:${String(error.message).replace(/^Quality gate failed after repair attempts:\s*/i, '')}`
          : `topic_failed:${String(error?.message || 'unknown error').slice(0, 300)}`
        console.warn(`Skipping topic ${topic.topic_key}: ${error?.message || error}`)
        if (!isSkippableTopicError(error) && error?.stack) console.warn(error.stack)
        skippedTopics.push(createTopicSnapshot(topic, {
          content_type: workflow.content_type,
          published_mode: runtime.mode === 'daily-manual' ? 'manual' : 'auto',
          reason,
          status: isSkippableTopicError(error) ? 'skipped' : 'failed',
        }))
      }
    }
  } catch (error) {
    runFailure = error
    throw error
  } finally {
    if (!runtime.dryRun) {
      await reportDailyRunOutcome({
        token,
        runtime,
        workflow,
        coverageDate,
        clusteredTopics,
        candidateTopics,
        selection,
        results,
        skippedTopics,
        runFailure,
      })
    }
  }

  return results
}

async function runWeeklyReviewMode(config, cliOptions) {
  const today = toCoverageDate(cliOptions.coverageDate)
  const weeklyConfig = config.weekly_review || {}
  const workflow = {
    ...getContentWorkflowProfile(config, 'weekly-review', today),
    // Fallbacks mirror config/auto-blog.config.json (they had drifted: 9000 vs 11000,
    // 1600 vs 1900), so a missing config key no longer silently lowers the target.
    target_min_chars: Number(weeklyConfig.target_min_chars || 11000),
    section_target_chars: Number(weeklyConfig.section_target_chars || 1900),
  }
  const slug = workflow.slug
  const formatProfile = getBlogFormatProfile(resolveFormatProfileName(config, 'weekly-review'))

  if (!cliOptions.dryRun && !cliOptions.force && (await checkSlugExists(slug))) {
    console.log(`Slug already exists: ${slug}`)
    const token = await getCachedAdminToken()
    await reportPublishingRun(token, {
      workflow_key: 'weekly_review',
      external_run_id: process.env.GITHUB_RUN_ID || '',
      run_mode: 'auto',
      status: 'skipped',
      coverage_date: today,
      message: `Weekly review skipped because slug already exists: ${slug}`,
      candidate_topics: [],
      published_topics: [],
      skipped_topics: [
        createTopicSnapshot(
          { title: slug, topic_key: slug, summary: '' },
          {
            topic_key: slug,
            title: slug,
            content_type: workflow.content_type,
            published_mode: 'auto',
            reason: 'slug already exists',
            status: 'skipped',
          }
        ),
      ],
    })
    return []
  }

  const baseItems = await collectBaseMaterials(config, {
    feedLimit: Number(weeklyConfig.base_feed_limit || 72),
    enrichLimit: Number(weeklyConfig.base_enrich_limit || 40),
    maxReturnItems: Number(weeklyConfig.base_material_cap || 56),
    coverageDate: today,
    lookbackDays: Number(weeklyConfig.lookback_days || 7),
    fallbackMinText: 1200,
  })
  if (baseItems.length === 0) {
    throw new Error('No usable base research items were collected')
  }

  let blogItems = []
  if (config.blogwatcher_enabled || config.weekly_review?.blogwatcher_enabled) {
    blogItems = await runBlogwatcher({
      config,
      maxItems: Number(weeklyConfig.blogwatcher_max_items || 18),
      mode: 'weekly-review',
      coverageDate: today,
      lookbackDays: Number(weeklyConfig.lookback_days || 7),
    })
  }

  // A weekly run that dies mid-way used to leave the publishing status showing the
  // previous run forever. Any failure now records a failed run before propagating.
  try {
    const preResearchPack = buildResearchPack({ baseItems, blogItems, paperItems: [] })
    const outline = await chooseTopicDetailed({
      researchPack: preResearchPack,
      formatProfile,
      today,
      workflow,
    })

    const arxivKeywords = normalizeKeywords(outline.arxiv_queries || outline.keywords || [])
    let paperItems = []
    if ((config.arxiv_enabled || config.weekly_review?.arxiv_enabled) && arxivKeywords.length > 0) {
      paperItems = await runArxiv({
        keywords: arxivKeywords,
        maxPapers: weeklyConfig.arxiv_max_papers || config.arxiv_max_papers || 2,
        minScore: weeklyConfig.arxiv_min_score || 0.8,
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
    const imageUploadToken = cliOptions.dryRun ? '' : await getCachedAdminToken()
    // Weekly never builds the topic guards (it publishes exactly one post), so it resolves the
    // published-image memory on its own — once a week, against our own API.
    const usedImages = config.source_image_picker_enabled
      ? await resolveUsedImageRegistry(
        { imageDedupe: resolveImageDedupeConfig(config, weeklyConfig), force: cliOptions.force, dryRun: cliOptions.dryRun },
        { coverageDate: today },
      )
      : null
    const artifact = await buildPublishablePost({
      outline,
      researchPack,
      formatProfile,
      config,
      today,
      metadata,
      fixedSlug: slug,
      workflow,
      imageUploadToken,
      dryRun: cliOptions.dryRun,
      usedImages,
    })

    const metadataBridgePayload = buildPublishingMetadataBridgePayload({
      postId: null,
      post: artifact.post,
      outline: artifact.outline,
      metadata,
      gate: artifact.gate,
      config,
      researchPack: artifact.researchPack,
      imagePlans: artifact.imagePlans,
      imageCoverage: artifact.imageCoverage || null,
      workflowKey: 'weekly_review',
      coverageDate: today,
      candidateTopics: [
        createTopicSnapshot(outline, {
          topic_key: metadata.topic_key,
          title: artifact.post.title,
          summary: artifact.post.summary,
          content_type: workflow.content_type,
          published_mode: 'auto',
          post_slug: artifact.post.slug,
          source_count: artifact.researchPack.sources.length,
          source_names: [...new Set(artifact.researchPack.sources.map((source) => source.source_name).filter(Boolean))],
        }),
      ],
    })
    const qualitySnapshotPayload = buildQualitySnapshotPayload({
      postId: null,
      post: artifact.post,
      outline: artifact.outline,
      metadata,
      gate: artifact.gate,
      config,
      researchPack: artifact.researchPack,
    })
    const topicMetadataPayload = buildTopicMetadataPayload({
      postId: null,
      post: artifact.post,
      outline: artifact.outline,
      metadata,
      gate: artifact.gate,
      researchPack: artifact.researchPack,
      config,
    })

    if (cliOptions.dryRun) {
      return [{
        ...artifact,
        cover_image: null,
        publishing_metadata: metadataBridgePayload,
        quality_snapshot: qualitySnapshotPayload,
        topic_metadata: topicMetadataPayload,
      }]
    }

    const token = imageUploadToken
    let result = await publishPost(token, artifact.post, null, { isPublished: false })
    metadataBridgePayload.post_id = Number.isFinite(Number(result?.id)) ? Number(result.id) : null
    qualitySnapshotPayload.post_id = metadataBridgePayload.post_id
    topicMetadataPayload.post_id = metadataBridgePayload.post_id

    let coverImage = ''
    const coverBrief = artifact.outline.cover_brief || artifact.outline.cover_prompt || ''
    if (metadataBridgePayload.post_id && coverBrief) {
      console.log('Requesting configured cover generation...')
      const coverResult = await generatePostCoverWithAdminApi(metadataBridgePayload.post_id, coverBrief, token)
      logCoverGenerationResult(`Cover image for ${slug}`, coverResult)
      coverImage = coverResult.ok ? coverResult.imageUrl : ''
    }

    // Same degradation policy as the daily path: a metadata bridge outage must not strand a
    // fully generated (and fully paid for) weekly review as an unpublished draft.
    const bridgeFailures = await runPublishingBridges(token, {
      metadataBridgePayload,
      qualitySnapshotPayload,
      topicMetadataPayload,
    })
    result = await publishPost(token, artifact.post, null, { isPublished: true })
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
    await triggerFrontendRefreshSafe({
      source: 'auto-blog',
      mode: 'weekly-review',
      coverage_date: today,
      published_count: 1,
      slug: artifact.post.slug,
    })
    return [{
      ...artifact,
      result,
      cover_image: coverImage || null,
      post: coverImage ? { ...artifact.post, cover_image: coverImage } : artifact.post,
      publishing_metadata: metadataBridgePayload,
      quality_snapshot: qualitySnapshotPayload,
      topic_metadata: topicMetadataPayload,
      bridge_failures: bridgeFailures,
    }]
  } catch (error) {
    if (!cliOptions.dryRun) {
      const failureToken = await getCachedAdminToken().catch(() => '')
      await reportPublishingRun(failureToken, {
        workflow_key: 'weekly_review',
        external_run_id: process.env.GITHUB_RUN_ID || '',
        run_mode: 'auto',
        status: 'failed',
        coverage_date: today,
        message: `Weekly review failed: ${String(error?.message || error).slice(0, 400)}`,
        candidate_topics: [],
        published_topics: [],
        skipped_topics: [
          createTopicSnapshot(
            { title: slug, topic_key: slug, summary: '' },
            {
              topic_key: slug,
              title: slug,
              content_type: workflow.content_type,
              published_mode: 'auto',
              reason: `run_failed:${String(error?.message || error).slice(0, 300)}`,
              status: 'failed',
            }
          ),
        ],
      })
    }
    throw error
  }
}

async function main() {
  const cliOptions = parseCliArgs()
  if (cliOptions.help) {
    console.log(AUTO_BLOG_CLI_HELP)
    return
  }

  console.log('Auto blog v4 starting...')
  console.log(`Publishing target: ${BLOG_API_BASE}`)

  const dryRun = cliOptions.dryRun
  if (dryRun) {
    console.log('Dry run: no post/image/metadata/deploy-hook writes. NOTE: LLM calls still run and are billed.')
  }

  if (!ADMIN_PASSWORD) throw new Error('Missing ADMIN_PASSWORD')

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
        image_coverage: item.imageCoverage || null,
        quality_gate: item.gate,
        post: item.post,
        cover_image: item.cover_image || null,
        publishing_metadata: item.publishing_metadata || null,
        quality_snapshot: item.quality_snapshot || null,
        topic_metadata: item.topic_metadata || null,
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
