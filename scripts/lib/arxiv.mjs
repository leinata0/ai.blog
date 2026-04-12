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

export function parseArxivFeed(xml) {
  const parsed = xmlParser.parse(xml)
  const entries = toArray(parsed?.feed?.entry)

  return entries.map((entry) => {
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
  }).filter((item) => item.title && item.url)
}

function buildQuery(keywords) {
  const normalized = Array.isArray(keywords) ? keywords : [keywords]
  const terms = normalized
    .flatMap((value) => String(value || '').split(/[,\n]/))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4)

  if (terms.length === 0) return ''
  return terms.map((term) => `all:${term.replace(/\s+/g, '+')}`).join('+AND+')
}

function scorePaper(item, keywords) {
  const haystack = `${item.title} ${item.summary}`.toLowerCase()
  const hits = (keywords || []).reduce((count, keyword) => (
    haystack.includes(String(keyword).toLowerCase()) ? count + 1 : count
  ), 0)

  return Number((item.score + hits * 0.08).toFixed(3))
}

export async function runArxiv({
  keywords,
  maxPapers = 2,
}) {
  const normalizedKeywords = Array.isArray(keywords) ? keywords.filter(Boolean) : [keywords].filter(Boolean)
  if (normalizedKeywords.length === 0) return []

  const query = buildQuery(normalizedKeywords)
  if (!query) return []

  const url = `https://export.arxiv.org/api/query?search_query=${query}&start=0&max_results=${Math.max(maxPapers * 2, 4)}&sortBy=submittedDate&sortOrder=descending`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'AutoArxiv/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`arxiv:${resp.status}`)
  }
  const xml = await resp.text()
  return parseArxivFeed(xml)
    .map((item) => ({ ...item, score: scorePaper(item, normalizedKeywords) }))
    .filter((item) => item.score >= 0.75)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxPapers)
}
