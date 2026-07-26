import { XMLParser } from 'fast-xml-parser'

import { extractFeedItemMediaCandidates } from './feed-media.mjs'

// removeNSPrefix 保持关闭：`content:encoded` / `media:content` 的键名就得是带冒号的原样，
// feed-media 按这个约定读取。改这里等于悄悄掐断 feed 正文图源。
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

const DEFAULT_BUCKET_ORDER = [
  'official_vendor',
  'global_media',
  'research_media',
  'independent',
  'cn_ai_media',
  'community',
]
const DAILY_TOPIC_MATCH_THRESHOLD = 0.8

const TOPIC_MATCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will',
  'with', 'about', 'after', 'before', 'over', 'under', 'launch', 'launches', 'released',
  'release', 'announces', 'announced', 'introduces', 'introduce', 'new', 'latest', 'today',
  'daily', 'report', 'update', 'updates', 'breaking', 'says', 'say',
])

// Feeds are fetched concurrently, but 29 simultaneous outbound sockets (plus the base
// feed fetch in auto-blog) is enough to trip rate limits and starve the event loop.
const FEED_FETCH_CONCURRENCY = 6
// A feed without Content-Length can stream unbounded data into memory. Cap what we read.
// 这个上限现在也决定了「能从 feed 正文里捞到多少配图」：全文 feed（content:encoded 带
// 整篇正文）单个响应体两三 MB 很常见，调低会直接截断正文、连带丢掉后半篇的插图。
const MAX_FEED_BYTES = 4 * 1024 * 1024

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// fast-xml-parser hands back a scalar for `<description>text</description>` but an object
// (`{ '#text': ..., '@_type': 'html' }`) as soon as the element carries an attribute, and an
// array when the element repeats. Blindly String()-ing those produced "[object Object]" and
// comma-joined garbage, so unwrap them explicitly.
function pickNodeText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = pickNodeText(entry)
      if (text) return text
    }
    return ''
  }
  if (typeof value === 'object') {
    if (value['#text'] !== undefined) return pickNodeText(value['#text'])
    if (value['@_href'] !== undefined) return String(value['@_href'])
  }
  return ''
}

// Atom entries usually carry several <link rel="..."> siblings; the previous
// `item.link?.['@_href'] || item.link` read stringified the whole array into a junk URL.
// Prefer rel="alternate" (the canonical article), then any href, then a plain-string link,
// then the guid — matching how `arxiv.mjs` already resolves entry links.
export function pickEntryLink(item) {
  const links = toArray(item?.link)
  const objectLinks = links.filter((link) => link && typeof link === 'object' && link['@_href'])
  const alternate = objectLinks.find((link) => {
    const rel = String(link['@_rel'] || '').toLowerCase()
    return !rel || rel === 'alternate'
  })
  if (alternate) return String(alternate['@_href'])
  if (objectLinks.length > 0) return String(objectLinks[0]['@_href'])

  const stringLink = links.find((link) => typeof link === 'string' && link.trim())
  if (stringLink) return stringLink.trim()

  return pickNodeText(item?.guid)
}

// Bounded-concurrency variant of Promise.allSettled: same result shape, but at most
// `concurrency` workers are in flight at once.
export async function mapWithConcurrency(items, worker, concurrency = FEED_FETCH_CONCURRENCY) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  const workers = Math.max(1, Math.min(Number(concurrency) || 1, list.length))
  let cursor = 0

  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))

  return results
}

export async function readResponseTextCapped(resp, maxBytes = MAX_FEED_BYTES) {
  const body = resp?.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await resp.text()
    return text.length > maxBytes ? text.slice(0, maxBytes) : text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let out = ''
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength ?? value.length ?? 0
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Stream already finished or errored; nothing to release.
    }
  }
  return out
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function scoreTimestamp(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildCoverageWindowEnd(coverageDate) {
  if (!coverageDate) return Date.now()
  const end = Date.parse(`${coverageDate}T23:59:59Z`)
  return Number.isFinite(end) ? end : Date.now()
}

function normalizeBucket(bucket) {
  return normalizeText(bucket).toLowerCase() || 'community'
}

function normalizeSourceGroup(value, fallback = '') {
  return normalizeText(value || fallback).toLowerCase()
}

function tokenizeTopicText(value) {
  const raw = normalizeText(value).toLowerCase()
  const matches = raw.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2,}/g) || []
  return matches
    .map((token) => token.trim())
    .filter((token) => token && !TOPIC_MATCH_STOP_WORDS.has(token))
}

function countTokenOverlap(left, right) {
  if (left.length === 0 || right.length === 0) return 0
  const rightSet = new Set(right)
  return left.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0)
}

function compareResearchItems(left, right, rankItem = (item) => Number(item?.score || 0)) {
  const leftScore = Number(rankItem(left) || 0)
  const rightScore = Number(rankItem(right) || 0)
  if (rightScore !== leftScore) return rightScore - leftScore
  return scoreTimestamp(right?.published_at) - scoreTimestamp(left?.published_at)
}

function dedupeSources(sources) {
  const seen = new Set()
  return (Array.isArray(sources) ? sources : []).filter((source) => {
    const feedUrl = normalizeText(source?.feed_url)
    const name = normalizeText(source?.name)
    if (!feedUrl || !name) return false
    const fingerprint = `${name}|${feedUrl}`.toLowerCase()
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function resolveSourceDiversityConfig(config = {}) {
  const root = config?.source_diversity || {}
  const preferredBucketOrder = Array.isArray(root?.preferred_bucket_order)
    ? root.preferred_bucket_order.map((item) => normalizeBucket(item)).filter(Boolean)
    : []

  return {
    enabled: Boolean(root.enabled ?? true),
    candidateCapPerSource: normalizePositiveInt(root.candidate_cap_per_source, 2),
    enrichmentCapPerSource: normalizePositiveInt(root.enrichment_cap_per_source, 1),
    preferredBucketOrder: preferredBucketOrder.length > 0 ? preferredBucketOrder : [...DEFAULT_BUCKET_ORDER],
  }
}

export function parseFeedXml(xml, source) {
  const parsed = xmlParser.parse(xml)
  const rssItems = toArray(parsed?.rss?.channel?.item)
  const atomItems = toArray(parsed?.feed?.entry)
  const entries = rssItems.length > 0 ? rssItems : atomItems
  const sourceName = normalizeText(source?.name) || normalizeText(source?.tag) || 'unknown'
  const sourceGroup = normalizeSourceGroup(source?.source_group, sourceName)
  const channelBucket = normalizeBucket(source?.channel_bucket)

  return entries
    .map((item) => {
      const url = normalizeText(pickEntryLink(item))
      return {
        source_type: source.source_type || 'independent_blog',
        source_name: sourceName,
        source_group: sourceGroup,
        channel_bucket: channelBucket,
        title: normalizeText(pickNodeText(item.title)),
        url,
        published_at: normalizeText(
          pickNodeText(item.pubDate) || pickNodeText(item.published) || pickNodeText(item.updated)
        ),
        lang: source.lang || 'en',
        summary: normalizeText(
          pickNodeText(item.description) || pickNodeText(item.summary) || pickNodeText(item.content)
        ),
        full_text: '',
        // feed 正文里的配图。这份数据本来就随 RSS 一起抓回来了，之前整段丢掉，插图候选
        // 只剩「事后再抓一次源站页面 HTML」这一条路 —— 而那条路会被 JS 注入正文和反爬
        // 打掉一大半。这里的图天然属于这篇文章，不是全站社交卡，相关性也更可靠。
        // 候选仍要过下游的尺寸/黑名单/SSRF 校验，本字段只负责供给。
        media_candidates: extractFeedItemMediaCandidates(item, { baseUrl: url }),
        score: Number(source.quality_weight || 0.5),
        evidence_snippets: [],
      }
    })
    .filter((item) => item.title && item.url)
}

export function dedupeResearchItems(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((item) => {
    const fingerprint = `${item?.url || ''}|${item?.title || ''}`.toLowerCase()
    if (!fingerprint || seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function scoreResearchItem(item, topicHint = '') {
  let score = Number(item.score || 0)
  if (item.source_type === 'official_blog') score += 0.35
  if (item.source_type === 'independent_blog') score += 0.2
  if (item.summary && item.summary.length > 120) score += 0.1
  const topicMatchScore = computeTopicMatchScore(item, topicHint)
  if (topicMatchScore > 0) {
    score += Math.min(1.2, topicMatchScore)
  } else if (topicHint) {
    score -= 0.2
  }
  return Number(score.toFixed(3))
}

export function computeTopicMatchScore(item, topicHint = '') {
  const normalizedHint = normalizeText(topicHint).toLowerCase()
  if (!normalizedHint) return 0

  const hintTokens = tokenizeTopicText(normalizedHint)
  if (hintTokens.length === 0) return 0

  const titleText = normalizeText(item?.title || '').toLowerCase()
  const summaryText = normalizeText(item?.summary || '').toLowerCase()
  if (!titleText && !summaryText) return 0

  const titleTokens = tokenizeTopicText(titleText)
  const summaryTokens = tokenizeTopicText(summaryText)
  const titleOverlap = countTokenOverlap(hintTokens, titleTokens)
  const summaryOverlap = countTokenOverlap(hintTokens, summaryTokens)
  const titleRatio = titleOverlap > 0 ? titleOverlap / Math.max(1, Math.min(hintTokens.length, 6)) : 0
  const summaryRatio = summaryOverlap > 0 ? summaryOverlap / Math.max(1, Math.min(hintTokens.length, 8)) : 0
  const exactPhraseBoost = titleText.includes(normalizedHint) ? 1.8 : 0
  return Number((exactPhraseBoost + titleOverlap * 0.45 + titleRatio * 0.9 + summaryOverlap * 0.1 + summaryRatio * 0.2).toFixed(3))
}

export function filterResearchItemsByPublishedWindow(
  items,
  {
    coverageDate = '',
    lookbackHours = 0,
    lookbackDays = 0,
    minItems = 0,
    rankItem = (item) => Number(item?.score || 0),
    // Backfill entries are stale by definition; demote them so they cannot outrank a
    // genuinely fresh item once a downstream stage re-sorts by score.
    backfillPenalty = 0.4,
    logger = null,
  } = {},
) {
  const normalizedItems = dedupeResearchItems(items)
  const totalLookbackMs = Number(lookbackHours) > 0
    ? Number(lookbackHours) * 60 * 60 * 1000
    : Number(lookbackDays) > 0
      ? Number(lookbackDays) * 24 * 60 * 60 * 1000
      : 0

  if (totalLookbackMs <= 0) {
    return normalizedItems.sort((left, right) => compareResearchItems(left, right, rankItem))
  }

  const endTs = buildCoverageWindowEnd(coverageDate)
  const startTs = endTs - totalLookbackMs
  const withTimestamp = []
  const withoutTimestamp = []
  const outsideWindow = []

  for (const item of normalizedItems) {
    const ts = scoreTimestamp(item?.published_at)
    if (ts > 0) {
      if (ts >= startTs && ts <= endTs) withTimestamp.push({ ...item, window_status: 'in_window' })
      else outsideWindow.push(item)
    } else {
      // Feeds such as Hacker News / GitHub Trending routinely omit a publish date. They stay
      // eligible (dropping them would gut the community bucket) but are tagged so downstream
      // reporting can tell "fresh" from "unknown".
      withoutTimestamp.push({ ...item, window_status: 'undated' })
    }
  }

  const primary = [
    ...withTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
    ...withoutTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
  ]

  const floor = Math.max(0, Number(minItems || 0))
  if (primary.length >= floor || outsideWindow.length === 0) return primary

  // The window is a hard filter with a bounded soft backfill: previously a shortfall threw
  // the whole lookback filter away and returned every item, so lookback_hours silently
  // stopped applying. Now we only borrow the few stale items needed to reach `minItems`,
  // and each borrowed item is flagged and score-penalized.
  const shortfall = floor - primary.length
  const backfill = outsideWindow
    .sort((left, right) => compareResearchItems(left, right, rankItem))
    .slice(0, shortfall)
    .map((item) => ({
      ...item,
      window_status: 'outside_lookback_window',
      outside_lookback_window: true,
      score: Number((Number(item?.score || 0) * (1 - Math.min(0.95, Math.max(0, backfillPenalty)))).toFixed(3)),
    }))

  logger?.warn?.(
    `Lookback window backfill: only ${primary.length}/${floor} items inside the window; `
    + `borrowing ${backfill.length} stale item(s) (of ${outsideWindow.length} available).`
  )

  return [...primary, ...backfill]
}

export function interleaveResearchItemsByBucket(
  items,
  {
    preferredBucketOrder = DEFAULT_BUCKET_ORDER,
    rankItem = (item) => Number(item?.score || 0),
  } = {},
) {
  const normalizedPreferredBuckets = preferredBucketOrder.map((bucket) => normalizeBucket(bucket))
  const orderedItems = dedupeResearchItems(items)
    .sort((left, right) => compareResearchItems(left, right, rankItem))
  const bucketQueues = new Map()

  for (const item of orderedItems) {
    const bucket = normalizeBucket(item?.channel_bucket)
    if (!bucketQueues.has(bucket)) bucketQueues.set(bucket, [])
    bucketQueues.get(bucket).push(item)
  }

  const bucketOrder = [
    ...normalizedPreferredBuckets,
    ...[...bucketQueues.keys()].filter((bucket) => !normalizedPreferredBuckets.includes(bucket)),
  ]

  const result = []
  while (result.length < orderedItems.length) {
    let added = false
    for (const bucket of bucketOrder) {
      const queue = bucketQueues.get(bucket)
      if (!queue || queue.length === 0) continue
      result.push(queue.shift())
      added = true
    }
    if (!added) break
  }

  return result
}

export function capResearchItemsPerSource(items, perSourceCap = 0) {
  const normalizedCap = Number(perSourceCap)
  if (!Number.isFinite(normalizedCap) || normalizedCap <= 0) {
    return dedupeResearchItems(items)
  }

  const counts = new Map()
  const results = []
  for (const item of dedupeResearchItems(items)) {
    const key = normalizeSourceGroup(item?.source_group, item?.source_name || item?.url || 'unknown')
    const current = counts.get(key) || 0
    if (current >= normalizedCap) continue
    counts.set(key, current + 1)
    results.push(item)
  }
  return results
}

export function applySourceDiversity(
  items,
  {
    enabled = true,
    preferredBucketOrder = DEFAULT_BUCKET_ORDER,
    perSourceCap = 0,
    maxItems = 0,
    rankItem = (item) => Number(item?.score || 0),
  } = {},
) {
  const baseItems = enabled
    ? capResearchItemsPerSource(
      interleaveResearchItemsByBucket(items, { preferredBucketOrder, rankItem }),
      perSourceCap,
    )
    : dedupeResearchItems(items).sort((left, right) => compareResearchItems(left, right, rankItem))

  const normalizedMaxItems = Number(maxItems)
  if (Number.isFinite(normalizedMaxItems) && normalizedMaxItems > 0) {
    return baseItems.slice(0, normalizedMaxItems)
  }
  return baseItems
}

export function resolveBlogwatcherPlan(config = {}, { mode = 'daily', topicHint = '' } = {}) {
  const weeklyConfig = config.weekly_review || {}
  const isWeeklyReview = mode === 'weekly-review'
  const enabled = Boolean(
    isWeeklyReview ? (weeklyConfig.blogwatcher_enabled ?? config.blogwatcher_enabled) : config.blogwatcher_enabled
  )
  const sources = dedupeSources(
    isWeeklyReview ? (weeklyConfig.blogwatcher_sources || config.blogwatcher_sources) : config.blogwatcher_sources
  )

  return {
    mode,
    topicHint: normalizeText(topicHint),
    enabled,
    maxItems: normalizePositiveInt(
      isWeeklyReview ? weeklyConfig.blogwatcher_max_items : config.blogwatcher_max_items,
      isWeeklyReview ? 12 : 10,
    ),
    sources,
    sourceDiversity: resolveSourceDiversityConfig(config),
    enhanced_source_policy: {
      firecrawl: isWeeklyReview ? (weeklyConfig.firecrawl_mode || 'fallback') : 'off',
      exa: isWeeklyReview ? (weeklyConfig.exa_mode || 'fallback') : 'off',
    },
  }
}

async function fetchFeed(source) {
  const resp = await fetch(source.feed_url, {
    headers: {
      'User-Agent': 'AutoBlogWatcher/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`feed:${source.name}:${resp.status}`)
  }
  const xml = await readResponseTextCapped(resp)
  return parseFeedXml(xml, source)
}

export async function runBlogwatcher({
  topicHint = '',
  config,
  maxItems,
  mode = 'daily',
  coverageDate = '',
  lookbackHours = 0,
  lookbackDays = 0,
}) {
  const plan = resolveBlogwatcherPlan(config, { mode, topicHint })
  if (!plan.enabled || plan.sources.length === 0) {
    return []
  }

  const settled = await mapWithConcurrency(plan.sources, (source) => fetchFeed(source), FEED_FETCH_CONCURRENCY)
  const scoredItems = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .map((item) => {
      const topicMatchScore = computeTopicMatchScore(item, plan.topicHint)
      return {
        ...item,
        topic_match_score: topicMatchScore,
        score: scoreResearchItem(item, plan.topicHint),
      }
    })

  let items = scoredItems
  if (plan.topicHint) {
    const matchedItems = scoredItems.filter((item) => Number(item.topic_match_score || 0) >= DAILY_TOPIC_MATCH_THRESHOLD)
    if (mode !== 'weekly-review') {
      items = matchedItems
    } else if (matchedItems.length > 0) {
      items = matchedItems
    }
  }

  if (items.length === 0) return []

  const filtered = filterResearchItemsByPublishedWindow(items, {
    coverageDate,
    lookbackHours,
    lookbackDays,
    minItems: Math.min(4, normalizePositiveInt(maxItems, plan.maxItems)),
  })

  return applySourceDiversity(filtered, {
    enabled: plan.sourceDiversity.enabled,
    preferredBucketOrder: plan.sourceDiversity.preferredBucketOrder,
    perSourceCap: plan.sourceDiversity.enrichmentCapPerSource,
    maxItems: normalizePositiveInt(maxItems, plan.maxItems),
    rankItem: (item) => Number(item?.score || 0),
  })
}
