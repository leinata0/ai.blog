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

function normalizeKeywords(keywords) {
  const values = Array.isArray(keywords) ? keywords : [keywords]
  return values
    .flatMap((value) => String(value || '').split(/[,\n]/))
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .slice(0, 6)
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseArxivFeed(xml) {
  const parsed = xmlParser.parse(xml)
  const entries = toArray(parsed?.feed?.entry)

  return entries
    .map((entry) => {
      const authors = toArray(entry.author).map((author) => normalizeText(author.name)).filter(Boolean)
      const summary = normalizeText(entry.summary)
      const primaryCategory = entry['arxiv:primary_category']?.['@_term'] || ''
      const link = toArray(entry.link).find((candidate) => candidate?.['@_href'])?.['@_href'] || ''

      return {
        source_type: 'paper',
        source_name: 'arXiv',
        title: normalizeText(entry.title),
        url: normalizeText(link || entry.id),
        published_at: normalizeText(entry.published),
        lang: 'en',
        summary,
        full_text: summary,
        score: 0.75,
        evidence_snippets: authors.length > 0 ? [authors.join(', '), primaryCategory].filter(Boolean) : [primaryCategory].filter(Boolean),
        authors,
        primary_category: primaryCategory,
      }
    })
    .filter((item) => item.title && item.url)
}

function buildQuery(keywords) {
  const terms = normalizeKeywords(keywords).slice(0, 4)
  if (terms.length === 0) return ''
  return terms.map((term) => `all:${term.replace(/\s+/g, '+')}`).join('+AND+')
}

function scorePaper(item, keywords) {
  const haystack = `${item.title} ${item.summary}`.toLowerCase()
  const hits = normalizeKeywords(keywords).reduce(
    (count, keyword) => (haystack.includes(String(keyword).toLowerCase()) ? count + 1 : count),
    0
  )

  return Number((item.score + hits * 0.08).toFixed(3))
}

export function resolveArxivPlan(config = {}, { mode = 'daily', keywords = [] } = {}) {
  const weeklyConfig = config.weekly_review || {}
  const isWeeklyReview = mode === 'weekly-review'
  const normalized = normalizeKeywords(keywords)
  const enabled = Boolean(
    isWeeklyReview ? (weeklyConfig.arxiv_enabled ?? config.arxiv_enabled) : config.arxiv_enabled
  )

  return {
    mode,
    keywords: normalized,
    enabled: enabled && normalized.length > 0,
    optional: isWeeklyReview ? (weeklyConfig.arxiv_optional ?? true) : true,
    maxPapers: Math.floor(
      normalizePositiveNumber(
        isWeeklyReview ? weeklyConfig.arxiv_max_papers : config.arxiv_max_papers,
        isWeeklyReview ? 3 : 2
      )
    ),
    minScore: normalizePositiveNumber(isWeeklyReview ? weeklyConfig.arxiv_min_score : undefined, 0.75),
  }
}

export async function runArxiv({
  keywords,
  maxPapers = 2,
  minScore = 0.75,
  config,
  mode = 'daily',
}) {
  const plan = config
    ? resolveArxivPlan(config, { mode, keywords })
    : {
        mode,
        keywords: normalizeKeywords(keywords),
        enabled: normalizeKeywords(keywords).length > 0,
        optional: true,
        maxPapers: Math.floor(normalizePositiveNumber(maxPapers, 2)),
        minScore: normalizePositiveNumber(minScore, 0.75),
      }

  if (!plan.enabled) return []

  const query = buildQuery(plan.keywords)
  if (!query) return []

  const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=${Math.max(plan.maxPapers * 2, 4)}&sortBy=submittedDate&sortOrder=descending`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'AutoArxiv/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`arxiv:${resp.status}`)
  }
  const xml = await resp.text()
  return parseArxivFeed(xml)
    .map((item) => ({ ...item, score: scorePaper(item, plan.keywords) }))
    .filter((item) => item.score >= plan.minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, plan.maxPapers)
}
