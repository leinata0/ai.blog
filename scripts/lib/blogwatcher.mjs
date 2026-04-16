import { XMLParser } from 'fast-xml-parser'

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

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
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
    .map((item) => ({
      source_type: source.source_type || 'independent_blog',
      source_name: sourceName,
      source_group: sourceGroup,
      channel_bucket: channelBucket,
      title: normalizeText(item.title?.['#text'] || item.title || ''),
      url: normalizeText(item.link?.['@_href'] || item.link || item.guid || ''),
      published_at: normalizeText(item.pubDate || item.published || item.updated || ''),
      lang: source.lang || 'en',
      summary: normalizeText(
        item.description || item.summary?.['#text'] || item.summary || item.content?.['#text'] || ''
      ),
      full_text: '',
      score: Number(source.quality_weight || 0.5),
      evidence_snippets: [],
    }))
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
  if (topicHint && `${item.title} ${item.summary}`.toLowerCase().includes(topicHint.toLowerCase())) {
    score += 0.15
  }
  return Number(score.toFixed(3))
}

export function filterResearchItemsByPublishedWindow(
  items,
  {
    coverageDate = '',
    lookbackHours = 0,
    lookbackDays = 0,
    minItems = 0,
    rankItem = (item) => Number(item?.score || 0),
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

  for (const item of normalizedItems) {
    const ts = scoreTimestamp(item?.published_at)
    if (ts > 0) {
      if (ts >= startTs && ts <= endTs) withTimestamp.push(item)
    } else {
      withoutTimestamp.push(item)
    }
  }

  const filtered = [
    ...withTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
    ...withoutTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
  ]

  if (filtered.length >= Number(minItems || 0)) return filtered
  return normalizedItems.sort((left, right) => compareResearchItems(left, right, rankItem))
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
  const xml = await resp.text()
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

  const settled = await Promise.allSettled(plan.sources.map((source) => fetchFeed(source)))
  const items = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .map((item) => ({ ...item, score: scoreResearchItem(item, plan.topicHint) }))

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
