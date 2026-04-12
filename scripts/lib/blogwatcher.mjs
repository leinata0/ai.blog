import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

export function parseFeedXml(xml, source) {
  const parsed = xmlParser.parse(xml)
  const rssItems = toArray(parsed?.rss?.channel?.item)
  const atomItems = toArray(parsed?.feed?.entry)
  const entries = rssItems.length > 0 ? rssItems : atomItems

  return entries.map((item) => ({
    source_type: source.source_type || 'independent_blog',
    source_name: source.name,
    title: normalizeText(item.title?.['#text'] || item.title || ''),
    url: normalizeText(item.link?.['@_href'] || item.link || item.guid || ''),
    published_at: normalizeText(item.pubDate || item.published || item.updated || ''),
    lang: source.lang || 'en',
    summary: normalizeText(item.description || item.summary?.['#text'] || item.summary || item.content?.['#text'] || ''),
    full_text: '',
    score: Number(source.quality_weight || 0.5),
    evidence_snippets: [],
  })).filter((item) => item.title && item.url)
}

export function dedupeResearchItems(items) {
  const seen = new Set()
  return items.filter((item) => {
    const fingerprint = `${item.url}|${item.title}`.toLowerCase()
    if (seen.has(fingerprint)) return false
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
  maxItems = 12,
}) {
  const sources = config.blogwatcher_sources || []
  const settled = await Promise.allSettled(sources.map((source) => fetchFeed(source)))
  const items = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .map((item) => ({ ...item, score: scoreResearchItem(item, topicHint) }))

  return dedupeResearchItems(items)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxItems)
}
