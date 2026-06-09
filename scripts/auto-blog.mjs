#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applySourceDiversity,
  dedupeResearchItems,
  filterResearchItemsByPublishedWindow,
  parseFeedXml,
  resolveSourceDiversityConfig,
  runBlogwatcher,
} from './lib/blogwatcher.mjs'
import { runArxiv } from './lib/arxiv.mjs'
import {
  getBlogFormatProfile,
  buildFormatPrompt,
  getContentWorkflowProfile,
  resolveFormatProfileName,
} from './lib/blog-format.mjs'
import { resolveAdminPassword, resolveAdminUsername, resolveBlogApiBase } from './lib/blog-api.mjs'
import { buildPostCoverPrompt } from './lib/cover-art.mjs'
import { evaluateQualityGate, formatQualityGateReport } from './lib/quality-gate.mjs'
import { generatePostCoverViaAdminJob, imageGenerationJobImageUrl, imageGenerationJobSucceeded } from './lib/admin-image-generation.mjs'
import { generateTextViaAdminApi } from './lib/admin-text-generation.mjs'
import { pickSourceImages } from './lib/source-image-picker.mjs'

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

const DAILY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will',
  'with', 'about', 'after', 'before', 'over', 'under', 'launch', 'launches', 'released',
  'release', 'announces', 'announced', 'introduces', 'introduce', 'new', 'latest', 'today',
  'daily', 'report', 'update', 'updates', 'breaking', 'says', 'say', 'ai', 'llm', 'model',
  'models', 'china', 'openai', 'anthropic', 'google', 'meta', 'microsoft',
])

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
  const bannedRatio = 1 - Math.min(1, Number(metrics.banned_phrase_hits || 0) / maxBannedHits)
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
  workflowKey,
  coverageDate,
  candidateTopics = [],
  failureReason = '',
}) {
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
      cover_prompt: String(outline?.cover_prompt || '').trim(),
    }),
    quality_gate_json: JSON.stringify(gate || {}),
    image_plan_json: JSON.stringify(Array.isArray(imagePlans) ? imagePlans : []),
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
  workflowKey,
  coverageDate,
  candidateTopics = [],
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
    workflowKey,
    coverageDate,
    candidateTopics,
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
  const bannedHits = Number(metrics.banned_phrase_hits || 0)
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
  if (!resp.ok) return []
  const xml = await resp.text()
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
  const settled = await Promise.allSettled((config.rss_feeds || []).map((feed) => fetchBaseFeed(feed)))
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
  const itemsWithLinks = feedItems.filter((item) => item.url).slice(0, enrichLimit)
  const enriched = await enrichWithFullText(itemsWithLinks)

  let materials = dedupeResearchItems(enriched)
  const combinedText = materials.map((item) => item.full_text || item.summary).join('\n')
  if (combinedText.length < fallbackMinText) {
    console.log('Base RSS materials are weak, using fallback pages...')
    for (const url of config.fallback_urls || []) {
      const markdown = await jinaRead(url, 6000)
      if (markdown.length <= 200) continue
      materials.push({
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
      topic_key: buildTopicKey(lead),
      title_key: cluster.title_key,
      candidate_title: lead?.title || 'AI 主题',
      lead_source_name: lead?.source_name || '',
      latest_published_at: orderedItems.map((item) => item.published_at).sort((left, right) => scoreTimestamp(right) - scoreTimestamp(left))[0] || '',
      score: Number(orderedItems.reduce((total, item) => total + itemRelevanceScore(item), 0).toFixed(4)),
      source_count: sources.size,
      bucket_count: channelBuckets.length,
      non_official_source_count: nonOfficialSourceCount,
      source_groups: sourceGroups,
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
      if ((right.bucket_count || 0) !== (left.bucket_count || 0)) return (right.bucket_count || 0) - (left.bucket_count || 0)
      if ((right.non_official_source_count || 0) !== (left.non_official_source_count || 0)) {
        return (right.non_official_source_count || 0) - (left.non_official_source_count || 0)
      }
      if (right.source_count !== left.source_count) return right.source_count - left.source_count
      if (right.score !== left.score) return right.score - left.score
      return scoreTimestamp(right.latest_published_at) - scoreTimestamp(left.latest_published_at)
    })

  return { queue, target_count: maxPosts, skipped_topic_keys: [...publishedTopicKeys] }
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

function ensureSectionHeading(markdown, heading) {
  const text = String(markdown || '').trim()
  if (!text) return `${heading}\n\n`
  if (text.startsWith(heading)) return text
  return `${heading}\n\n${text.replace(/^#{1,6}\s+.*$/m, '').trim()}`
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

async function getCachedAdminToken() {
  if (!adminTokenCache) {
    adminTokenCache = await getAdminToken()
  }
  return adminTokenCache
}

export function buildLLMMaxTokenAttempts(maxTokens = 16384) {
  const requested = Math.max(1, Math.floor(Number(maxTokens) || 16384))
  return [requested, 8192, 4096, 3072]
    .map((value) => Math.min(requested, value))
    .filter((value, index, values) => values.indexOf(value) === index)
}

async function callLLM(systemPrompt, userPrompt, maxTokens = 16384) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const maxTokenAttempts = buildLLMMaxTokenAttempts(maxTokens)
  let lastError = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) {
      const sec = [0, 10, 30, 60][attempt - 1]
      console.log(`Retrying LLM call in ${sec}s...`)
      await sleep(sec * 1000)
    }

    const maxTokensForAttempt = maxTokenAttempts[Math.min(attempt - 1, maxTokenAttempts.length - 1)]
    if (maxTokensForAttempt !== maxTokens) {
      console.log(`Retrying LLM call with reduced max_tokens=${maxTokensForAttempt} (requested ${maxTokens})...`)
    }

    for (const jsonMode of [true, false]) {
      try {
        const raw = await generateTextViaAdminApi({
          blogApiBase: BLOG_API_BASE,
          token: await getCachedAdminToken(),
          messages,
          maxTokens: maxTokensForAttempt,
          temperature: 0.55,
          jsonMode,
          timeoutMs: 240000,
        })
        try {
          return parseJsonFromLlm(raw)
        } catch {
          lastError = `JSON parse failed: ${String(raw).slice(0, 200)}`
        }
      } catch (error) {
        lastError = error?.message || 'admin text generation failed'
        if (/^Admin text generation failed:\s*(401|403)\b/i.test(lastError)) throw error
      }
    }
  }

  throw new Error(`LLM failed after retries: ${lastError.slice(0, 500)}`)
}

export function createDailyBriefFormatProfile() {
  const baseProfile = getBlogFormatProfile('tech-editorial-v1')
  return {
    ...baseProfile,
    name: 'daily_brief',
    required_sections: [...baseProfile.required_sections],
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
    '- Add 2-4 third-level subheadings (###) across the middle and later sections so the article feels like a deep single-topic analysis.',
    '- image_sections 最多 3 个，只能从 outline 里挑。',
    '- thesis 是一句明确判断，不是摘要。',
    '- key_sources 用标题或 URL 标识真正重要的来源。',
    '- cover_prompt 只用于封面图生成，不要提及正文插图。',
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
    '- 正文中的关键事实、数据、产品发布、论文观点必须使用 researchPack.evidence_cards 里的来源编号标注，例如 [S1]、[S2]。',
    '- 每个主要章节至少使用 1 个来源编号，全文至少使用 2 个不同来源编号；不要编造未提供的 [S99] 之类编号。',
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

function normalizeSectionBriefs(outline, formatProfile) {
  const byHeading = new Map()
  for (const brief of Array.isArray(outline?.section_briefs) ? outline.section_briefs : []) {
    const heading = String(brief?.heading || '').trim()
    if (!heading) continue
    byHeading.set(heading, {
      heading,
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

  return formatProfile.required_sections.map((heading, index) => byHeading.get(heading) || {
    heading,
    goal: index === 0
      ? 'Open the article with a weekly overview and identify the main strategic shift.'
      : 'Develop this section into a substantive analytical chapter tied to the week.',
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
  const system = isWeeklyReview
    ? [
        'You are planning a premium Chinese weekly AI review.',
        'This is not a single-news article. It must synthesize the most important changes across the full week.',
        'Return JSON with keys:',
        'topic, thesis, keywords, arxiv_queries, outline, section_briefs, image_sections, key_sources, tags, cover_prompt, watchlist',
        'Requirements:',
        '- Cover the week as a whole, not one company announcement.',
        '- The outline must use the exact required section headings provided by the format profile.',
        '- Provide section_briefs as an array. Each item must have heading, goal, angle, key_points, must_use_sources, evidence_cards, source_focus, suggested_subheads, counterpoint, style_constraints, avoid.',
        '- weekly_axes must contain 3 to 4 major weekly themes.',
        '- Add 8 to 14 third-level subheadings distributed across the middle and later sections.',
        '- key_sources must identify the source IDs or URLs that are truly central to the weekly argument.',
        '- section_briefs.source_focus and must_use_sources should prefer concrete source IDs such as S1/S2 from evidence_cards.',
        '- image_sections can include at most 3 section headings.',
        '- cover_prompt is only for cover-image generation and must not mention inline images.',
      ].join('\n')
    : [
        'You are planning a Chinese AI daily brief with one clear thesis.',
        'Return JSON with keys:',
        'topic, thesis, keywords, arxiv_queries, outline, section_briefs, evidence_cards, counterpoints, reader_question, image_sections, key_sources, tags, cover_prompt',
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
        '- cover_prompt is only for cover-image generation and must not mention inline images.',
      ].join('\n')

  const user = [
    `Date: ${today}`,
    `Workflow content type: ${workflow?.content_type || 'daily_brief'}`,
    '',
    'Format profile:',
    buildFormatPrompt(formatProfile),
    '',
    'Research pack:',
    stringifyPromptPayload(researchPack, isWeeklyReview ? 22000 : 14000),
  ].join('\n')

  return callLLM(system, user, isWeeklyReview ? 4096 : 3072)
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

  return callLLM(system, user, 2048)
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

  return callLLM(system, user, 6144)
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

  return callLLM(system, user, 2048)
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

  const result = await callLLM(system, user, 6144)
  return ensureSectionHeading(result.markdown || result.section_md || result.content_md || '', heading)
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
  const sectionTargetChars = Number(workflow.section_target_chars || 1600)
  const renderedSections = []

  for (const brief of sectionBriefs) {
    const section = await generateWeeklyReviewSection({
      heading: brief.heading,
      brief,
      outline,
      researchPack,
      formatProfile,
      workflow,
      today,
      targetChars: sectionTargetChars,
    })
    renderedSections.push(String(section.content_md || section.section_md || section.markdown || '').trim())
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
  attempt,
}) {
  const markerHints = (formatProfile.analysis_markers || []).slice(0, 8).join(' / ')
  const system = [
    'You are expanding one section of a Chinese weekly AI review after a quality-gate failure.',
    'Return only JSON with one key: markdown.',
    `The section must start with the exact heading: ${heading}`,
    `Expand this section so it approaches ${targetChars} Chinese characters on its own.`,
    'Preserve the current factual basis and thesis, but make the section deeper, broader, and more analytical.',
    `Use at least 4 substantial paragraphs and at least 2 explicit analytical turns, preferably using phrases such as ${markerHints}.`,
    'Use provided source IDs such as [S1] for factual claims; do not invent source IDs.',
    'You may add 1 to 2 Markdown ### subheadings if they improve structure.',
    'Do not output references, image sources, or article-level conclusions.',
  ].join('\n')

  const user = [
    `Repair attempt: ${attempt}`,
    `Date: ${today}`,
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

  const result = await callLLM(system, user, 6144)
  return ensureSectionHeading(result.markdown || result.section_md || result.content_md || '', heading)
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
  const candidates = sectionBriefs.map((brief) => {
    const markdown = currentSections.get(brief.heading) || `${brief.heading}\n\n`
    const charCount = stripMarkdownForLength(markdown).length
    return { brief, markdown, charCount }
  })

  let sectionsToRepair = candidates.filter((candidate) => candidate.charCount < minSectionChars)
  if (sectionsToRepair.length === 0 && (needsAnalysisBoost || gate.reasons.some((reason) => reason.startsWith('chars:')))) {
    sectionsToRepair = [...candidates].sort((left, right) => left.charCount - right.charCount).slice(0, 4)
  } else {
    sectionsToRepair = [...sectionsToRepair].sort((left, right) => left.charCount - right.charCount).slice(0, 4)
  }

  const repairedSections = new Map(currentSections)
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
      attempt,
    })
    repairedSections.set(candidate.brief.heading, repairedMarkdown)
  }

  return {
    ...post,
    slug: workflow.slug,
    content_md: requiredSections
      .map((heading) => ensureSectionHeading(repairedSections.get(heading) || '', heading))
      .join('\n\n'),
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
  ]

  return gate.reasons.length > 0
    && gate.reasons.every((reason) => !nonRepairablePrefixes.some((prefix) => reason.startsWith(prefix)))
    && gate.reasons.every((reason) => repairablePrefixes.some((prefix) => reason.startsWith(prefix)))
}

export function normalizeArticleCoverPromptResult(result = {}) {
  const prompt = String(result?.prompt || result?.image_prompt || result?.cover_prompt || '').trim()
  if (prompt.length < 40) return ''

  const avoidItems = Array.isArray(result?.avoid)
    ? result.avoid.map((item) => String(item || '').trim()).filter(Boolean)
    : String(result?.avoid || '').split(/[,;，；]/).map((item) => item.trim()).filter(Boolean)
  const avoidClause = avoidItems.length > 0 ? ` Avoid ${avoidItems.slice(0, 8).join(', ')}.` : ''
  return `${prompt.replace(/\s+/g, ' ')}${avoidClause}`.trim()
}

async function generateArticleCoverPrompt({ post, outline, researchPack, workflow, today }) {
  const system = [
    'You are an art director for a Chinese AI/technology editorial blog.',
    'Your job is to create one differentiated image-generation prompt for the article cover.',
    'Return only JSON with keys: visual_metaphor, scene, style, palette, composition, avoid, prompt.',
    'The prompt field must be a complete English-first image prompt suitable for an image generation API.',
    'Choose a visual language that fits this specific article, not a generic AI poster.',
    'Vary the medium when appropriate: documentary editorial photography, minimal infographic, paper-cut editorial illustration, isometric product metaphor, archival newsroom collage, lab still life, architectural metaphor, or restrained 3D object study.',
    'Do not request readable text, title typography, logos, UI screenshots, code editors, human faces, hands, robot mascots, or clutter.',
    'Avoid generic glowing AI brain, blue-purple cyberpunk, humanoid robot, floating holographic dashboard, and circuit-board clichés unless the article specifically requires them.',
    'Respect a wide landscape website cover composition with a calmer lower area for overlay text.',
  ].join('\n')

  const user = [
    `Date: ${today}`,
    `Workflow: ${workflow?.slug || ''}`,
    '',
    'Article:',
    stringifyPromptPayload({
      title: post?.title,
      summary: post?.summary,
      tags: post?.tags,
      topic_key: post?.topic_key,
      content_type: post?.content_type,
      content_preview: smartTruncate(post?.content_md || '', 4000),
    }, 6000),
    '',
    'Outline cover idea:',
    String(outline?.cover_prompt || '').trim(),
    '',
    'Research/evidence context:',
    stringifyPromptPayload({
      topic: outline?.topic,
      thesis: outline?.thesis,
      key_sources: outline?.key_sources,
      evidence_cards: Array.isArray(researchPack?.evidence_cards) ? researchPack.evidence_cards.slice(0, 8) : [],
      sources: Array.isArray(researchPack?.sources) ? researchPack.sources.slice(0, 8).map((item) => ({
        title: item.title,
        source_name: item.source_name,
        source_type: item.source_type,
        summary: item.summary,
      })) : [],
    }, 10000),
  ].join('\n')

  return callLLM(system, user, 2048)
}

async function generateArticleCoverPromptSafe(args) {
  try {
    const result = await generateArticleCoverPrompt(args)
    const prompt = normalizeArticleCoverPromptResult(result)
    if (prompt) {
      console.log(`Generated refined cover prompt: ${prompt.slice(0, 180)}`)
      return prompt
    }
    console.warn('Refined cover prompt was empty; falling back to outline cover prompt.')
  } catch (error) {
    console.warn(`Refined cover prompt generation skipped: ${error.message}`)
  }
  return ''
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

  const result = await callLLM(system, user, 6144)
  return ensureSectionHeading(result.markdown || result.section_md || result.content_md || '', heading)
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
  const requiredSections = formatProfile.required_sections || []
  const currentSections = extractArticleSections(post.content_md, requiredSections)
  const sectionBriefs = normalizeSectionBriefs(outline, formatProfile)
  const reasonHeadings = headingsFromGateReasons(gate.reasons, requiredSections)
  const minSectionChars = Math.max(550, Number(gateProfile.min_section_chars || 0))
  const targetSectionChars = Math.max(Number(workflow.section_target_chars || 850), minSectionChars + 250)
  const needsGlobalBoost = gate.reasons.some((reason) => (
    reason.startsWith('chars:')
    || reason.startsWith('analysis_signals:')
    || reason.startsWith('subheadings:')
    || reason.startsWith('body_source_mentions:')
    || reason.startsWith('analysis_sections:')
    || reason.startsWith('short_paragraph_ratio:')
  ))
  const candidates = sectionBriefs.map((brief) => {
    const markdown = currentSections.get(brief.heading) || `${brief.heading}\n\n`
    const charCount = stripMarkdownForLength(markdown).length
    const targeted = reasonHeadings.has(brief.heading)
    return { brief, markdown, charCount, targeted }
  })

  let sectionsToRepair = candidates.filter((candidate) => candidate.targeted || candidate.charCount < minSectionChars)
  if (sectionsToRepair.length === 0 && needsGlobalBoost) {
    sectionsToRepair = [...candidates].sort((left, right) => left.charCount - right.charCount).slice(0, 3)
  } else {
    sectionsToRepair = [...sectionsToRepair].sort((left, right) => left.charCount - right.charCount).slice(0, 3)
  }

  const repairedSections = new Map(currentSections)
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
    content_md: requiredSections
      .map((heading) => ensureSectionHeading(repairedSections.get(heading) || '', heading))
      .join('\n\n'),
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

async function downloadAndUploadImage(imageUrl, token) {
  const result = await downloadAndUploadImageResult(imageUrl, token)
  return result.ok ? result.imageUrl : null
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

async function downloadAndUploadImageResult(imageUrl, token) {
  try {
    const resp = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutoBlogBot/3.0)' },
    })
    if (!resp.ok) {
      return buildCoverGenerationResult({
        ok: false,
        errorCode: 'download_failed',
        error: `Failed to download generated image: HTTP ${resp.status}`,
      })
    }
    const contentType = resp.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) {
      return buildCoverGenerationResult({
        ok: false,
        errorCode: 'download_failed',
        error: 'Generated asset is not an image.',
      })
    }
    const buffer = Buffer.from(await resp.arrayBuffer())
    if (buffer.length < 1000 || buffer.length > 5 * 1024 * 1024) {
      return buildCoverGenerationResult({
        ok: false,
        errorCode: 'download_failed',
        error: 'Generated image size is outside the accepted upload range.',
      })
    }

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
    if (!uploadResp.ok) {
      return buildCoverGenerationResult({
        ok: false,
        errorCode: 'upload_failed',
        error: `Failed to upload generated image: HTTP ${uploadResp.status}`,
      })
    }
    const data = await uploadResp.json()
    return buildCoverGenerationResult({
      ok: true,
      imageUrl: data.url?.startsWith('http') ? data.url : `${BLOG_API_BASE}${data.url}`,
      sourceUrl: imageUrl,
    })
  } catch (error) {
    return buildCoverGenerationResult({
      ok: false,
      errorCode: 'upload_failed',
      error: error?.message || 'Failed to download or upload generated image.',
    })
  }
}

async function generatePostCoverWithAdminApi(postId, prompt, token) {
  try {
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: BLOG_API_BASE,
      token,
      postId,
      prompt,
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

async function getAdminToken() {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) throw new Error(`Admin login failed: ${resp.status}`)
  return (await resp.json()).access_token
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

async function fetchExistingPost(slug) {
  try {
    const resp = await fetch(`${BLOG_API_BASE}/api/posts/${slug}`, {
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
  const mainContent = String(post.content_md || '').trim()
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

async function publishPost(token, payload, coverImage = null) {
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
    is_published: true,
    is_pinned: false,
  }
  if (coverImage !== null && coverImage !== undefined) {
    requestBody.cover_image = coverImage
  }

  const existingPost = await fetchExistingPost(payload.slug)
  if (existingPost?.id) {
    const updateResp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${existingPost.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    })
    if (!updateResp.ok) {
      throw new Error(`Publish update failed: ${updateResp.status} ${(await updateResp.text()).slice(0, 300)}`)
    }
    return updateResp.json()
  }

  const resp = await fetch(`${BLOG_API_BASE}/api/admin/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30000),
  })

  if (resp.status === 409) {
    const conflictPost = await fetchExistingPost(payload.slug)
    if (conflictPost?.id) {
      const retryResp = await fetch(`${BLOG_API_BASE}/api/admin/posts/${conflictPost.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30000),
      })
      if (!retryResp.ok) {
        throw new Error(`Publish conflict-retry failed: ${retryResp.status} ${(await retryResp.text()).slice(0, 300)}`)
      }
      return retryResp.json()
    }
  }

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

async function upsertPublishingMetadata(token, payload) {
  const resp = await fetch(`${BLOG_API_BASE}/api/admin/publishing-metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) {
    throw new Error(`Publishing metadata bridge failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
  return resp.json()
}

async function bridgePublishingMetadata(token, payload) {
  if (!token || !payload) return null
  try {
    return await upsertPublishingMetadata(token, payload)
  } catch (error) {
    const postLabel = payload?.post_slug || payload?.post_id || 'unknown-post'
    console.warn(`Failed to bridge publishing metadata for ${postLabel}: ${error.message}`)
    return null
  }
}

async function upsertQualitySnapshot(token, payload) {
  if (!token || !payload?.post_id) return null
  const postId = Number(payload.post_id)
  const endpoints = [
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/quality`,
      body: {
        quality_snapshot: payload.quality_snapshot,
      },
    },
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/quality-snapshot`,
      body: payload,
    },
    {
      method: 'POST',
      url: `${BLOG_API_BASE}/api/admin/quality-snapshots`,
      body: payload,
    },
  ]

  const failures = []
  for (const endpoint of endpoints) {
    const resp = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(endpoint.body),
    })
    if (resp.ok) {
      const text = await resp.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return { status: 'ok' }
      }
    }
    if (resp.status === 404 || resp.status === 405) {
      failures.push(`${endpoint.method} ${endpoint.url} -> ${resp.status}`)
      continue
    }
    throw new Error(`Quality snapshot bridge failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  throw new Error(`Quality snapshot endpoint unavailable (${failures.join('; ')})`)
}

async function bridgeQualitySnapshot(token, payload) {
  if (!token || !payload) return null
  try {
    return await upsertQualitySnapshot(token, payload)
  } catch (error) {
    console.warn(`Failed to bridge quality snapshot: ${error.message}`)
    return null
  }
}

async function upsertTopicMetadata(token, payload) {
  if (!token || !payload?.post_id) return null
  const postId = Number(payload.post_id)
  const endpoints = [
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-metadata`,
      body: payload,
    },
    {
      method: 'PUT',
      url: `${BLOG_API_BASE}/api/admin/posts/${postId}/topic-profile`,
      body: payload,
    },
    {
      method: 'POST',
      url: `${BLOG_API_BASE}/api/admin/topic-metadata`,
      body: payload,
    },
  ]

  const failures = []
  for (const endpoint of endpoints) {
    const resp = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(endpoint.body),
    })
    if (resp.ok) {
      const text = await resp.text()
      if (!text) return null
      try {
        return JSON.parse(text)
      } catch {
        return { status: 'ok' }
      }
    }
    if (resp.status === 404 || resp.status === 405) {
      failures.push(`${endpoint.method} ${endpoint.url} -> ${resp.status}`)
      continue
    }
    throw new Error(`Topic metadata bridge failed: ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }

  throw new Error(`Topic metadata endpoint unavailable (${failures.join('; ')})`)
}

async function bridgeTopicMetadata(token, payload) {
  if (!token || !payload) return null
  try {
    return await upsertTopicMetadata(token, payload)
  } catch (error) {
    console.warn(`Failed to bridge topic metadata: ${error.message}`)
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
      sourceItems: applyPrimarySourceHintsToSources(
        researchPack.sources.filter((item) => (
          (config.image_selection_rules?.allowed_source_types || []).includes(item.source_type)
        )),
        outline,
      ),
      config,
    })
  }

  let generatedPost = await generateArticleForWorkflow({
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

  const normalizedPost = normalizeForApi(postForGate, fixedSlug, outline, metadata)
  const refinedCoverPrompt = await generateArticleCoverPromptSafe({
    post: normalizedPost,
    outline,
    researchPack,
    workflow: workflowProfile,
    today,
  })
  const normalizedOutline = {
    ...outline,
    cover_prompt: buildPostCoverPrompt(normalizedPost, {
      manualPrompt: refinedCoverPrompt || String(outline?.cover_prompt || '').trim(),
    }),
  }

  return {
    outline: normalizedOutline,
    researchPack,
    imagePlans,
    gate,
    post: normalizedPost,
  }
}

async function runDailyMode(config, cliOptions) {
  const runtime = resolveDailyRuntime(config, cliOptions)
  const baseItems = await collectBaseMaterials(config, {
    coverageDate: runtime.coverageDate,
    lookbackHours: runtime.lookbackHours,
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
  const publishedTopicKeys = runtime.skipPublishedTopicKeys && !runtime.force && !runtime.dryRun
    ? await fetchPublishedTopicKeys({ coverageDate })
    : new Set()
  const selection = selectTopicsForPublishing(clusteredTopics, {
    maxPosts: runtime.maxPosts,
    minSourcesPerTopic: runtime.minSourcesPerTopic,
    publishedTopicKeys,
  })

  const token = runtime.dryRun ? null : await getCachedAdminToken()
  const candidateTopics = clusteredTopics.map((topic) => createTopicSnapshot(topic, {
    content_type: workflow.content_type,
  }))
  const skippedTopics = []
  const results = []
  const gateProfile = resolveGateProfile(config, workflow.content_type)

  if (selection.queue.length === 0) {
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

  for (const topic of selection.queue) {
    if (results.length >= selection.target_count) break

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

    let artifact = null
    try {
      artifact = await buildPublishablePost({
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
    } catch (error) {
      if (!String(error?.message || '').startsWith('Quality gate failed after repair attempts:')) {
        throw error
      }

      console.log(`Skipping topic ${topic.topic_key}: ${error.message}`)
      skippedTopics.push(createTopicSnapshot(topic, {
        content_type: workflow.content_type,
        published_mode: metadata.published_mode,
        reason: `quality_gate_failed:${error.message.replace(/^Quality gate failed after repair attempts:\s*/i, '')}`,
        status: 'skipped',
      }))
      continue
    }

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

    const result = await publishPost(token, artifact.post)
    metadataBridgePayload.post_id = Number.isFinite(Number(result?.id)) ? Number(result.id) : null
    qualitySnapshotPayload.post_id = metadataBridgePayload.post_id
    topicMetadataPayload.post_id = metadataBridgePayload.post_id

    let coverImage = ''
    if (metadataBridgePayload.post_id && artifact.outline.cover_prompt) {
      console.log(`Requesting configured cover generation for ${slug}...`)
      const coverResult = await generatePostCoverWithAdminApi(metadataBridgePayload.post_id, artifact.outline.cover_prompt, token)
      logCoverGenerationResult(`Cover image for ${slug}`, coverResult)
      coverImage = coverResult.ok ? coverResult.imageUrl : ''
    }

    await bridgePublishingMetadata(token, metadataBridgePayload)
    await bridgeQualitySnapshot(token, qualitySnapshotPayload)
    await bridgeTopicMetadata(token, topicMetadataPayload)
    console.log(`Published daily brief: id=${result.id} slug=${artifact.post.slug}`)
    results.push({
      ...artifact,
      result,
      cover_image: coverImage || null,
      post: coverImage ? { ...artifact.post, cover_image: coverImage } : artifact.post,
      publishing_metadata: metadataBridgePayload,
      quality_snapshot: qualitySnapshotPayload,
      topic_metadata: topicMetadataPayload,
    })
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

    if (results.length > 0) {
      await triggerFrontendRefreshSafe({
        source: 'auto-blog',
        mode: runtime.mode,
        coverage_date: coverageDate,
        published_count: results.length,
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
    target_min_chars: Number(weeklyConfig.target_min_chars || 9000),
    section_target_chars: Number(weeklyConfig.section_target_chars || 1600),
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
    enrichLimit: Number(weeklyConfig.base_enrich_limit || 30),
    maxReturnItems: Number(weeklyConfig.base_material_cap || 42),
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

  const metadataBridgePayload = buildPublishingMetadataBridgePayload({
    postId: null,
    post: artifact.post,
    outline: artifact.outline,
    metadata,
    gate: artifact.gate,
    config,
    researchPack: artifact.researchPack,
    imagePlans: artifact.imagePlans,
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

  const token = await getCachedAdminToken()
  const result = await publishPost(token, artifact.post)
  metadataBridgePayload.post_id = Number.isFinite(Number(result?.id)) ? Number(result.id) : null
  qualitySnapshotPayload.post_id = metadataBridgePayload.post_id
  topicMetadataPayload.post_id = metadataBridgePayload.post_id

  let coverImage = ''
  if (metadataBridgePayload.post_id && outline.cover_prompt) {
    console.log('Requesting configured cover generation...')
    const coverResult = await generatePostCoverWithAdminApi(metadataBridgePayload.post_id, outline.cover_prompt, token)
    logCoverGenerationResult(`Cover image for ${slug}`, coverResult)
    coverImage = coverResult.ok ? coverResult.imageUrl : ''
  }

  await bridgePublishingMetadata(token, metadataBridgePayload)
  await bridgeQualitySnapshot(token, qualitySnapshotPayload)
  await bridgeTopicMetadata(token, topicMetadataPayload)
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
  }]
}

async function main() {
  console.log('Auto blog v4 starting...')
  console.log(`Publishing target: ${BLOG_API_BASE}`)

  const cliOptions = parseCliArgs()
  const dryRun = cliOptions.dryRun

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
