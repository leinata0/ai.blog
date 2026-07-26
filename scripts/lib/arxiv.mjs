import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
})

const ARXIV_REQUEST_TIMEOUT_MS = 15000
// arXiv answers with a small Atom feed (a handful of entries). Anything far larger is a
// redirect to an error page or a proxy injecting content; refuse it instead of buffering
// an unbounded body into memory.
const MAX_FEED_BYTES = 2 * 1024 * 1024

// fast-xml-parser returns `{ '#text': ..., '@_attr': ... }` for any element that carries
// attributes (arXiv emits `<title type="text">` and friends), so a bare String() would
// yield "[object Object]". Always unwrap through here.
function pickText(value) {
  if (value == null) return ''
  if (typeof value === 'object') {
    if (Array.isArray(value)) return pickText(value[0])
    return String(value['#text'] ?? '')
  }
  return String(value)
}

function normalizeText(value) {
  return pickText(value).replace(/\s+/g, ' ').trim()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// Atom entries carry several <link rel="..."> siblings (alternate/HTML page, related/PDF,
// sometimes DOI). fast-xml-parser turns those into an array, so the link must be selected
// by `rel`, never read as `entry.link['@_href'] || entry.link` — that yields a
// comma-joined garbage URL as soon as more than one link is present.
function pickEntryLink(entry) {
  const links = toArray(entry?.link).filter((candidate) => candidate?.['@_href'])
  const alternate = links.find((candidate) => String(candidate['@_rel'] || '') === 'alternate')
  return String((alternate || links[0])?.['@_href'] || '')
}

async function readFeedText(response, maxBytes = MAX_FEED_BYTES) {
  const declared = Number(response.headers?.get?.('content-length') || '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`arxiv:response_too_large:${declared}`)
  }

  const body = response.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('arxiv:response_too_large')
    return text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let received = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new Error(`arxiv:response_too_large:${received}`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
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
      const authors = toArray(entry.author).map((author) => normalizeText(author?.name ?? author)).filter(Boolean)
      const summary = normalizeText(entry.summary)
      const primaryCategory = String(entry['arxiv:primary_category']?.['@_term'] || '')
      const link = pickEntryLink(entry)

      return {
        source_type: 'paper',
        source_name: 'arXiv',
        source_group: 'arxiv',
        channel_bucket: 'research_media',
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
  return terms.map((term) => `all:${encodeURIComponent(term).replace(/%20/g, '+')}`).join('+AND+')
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
  fetchImpl = fetch,
  timeoutMs = ARXIV_REQUEST_TIMEOUT_MS,
  maxResponseBytes = MAX_FEED_BYTES,
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
  // A single sequential request per run — arXiv asks API clients not to fan out, so there
  // is intentionally no concurrency here.
  const resp = await fetchImpl(url, {
    headers: { 'User-Agent': 'AutoArxiv/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!resp.ok) {
    throw new Error(`arxiv:${resp.status}`)
  }
  const xml = await readFeedText(resp, maxResponseBytes)
  return parseArxivFeed(xml)
    .map((item) => ({ ...item, score: scorePaper(item, plan.keywords) }))
    .filter((item) => item.score >= plan.minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, plan.maxPapers)
}
