import { fetchPublicResource, readLimitedResponseBody } from './image-localizer.mjs'
import { isPublicHttpUrl } from './url-guard.mjs'

// Source pages are third-party HTML of unknown size; without a ceiling a single
// hostile or broken origin can exhaust the worker's memory via response.text().
const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024

function absoluteUrl(baseUrl, candidate) {
  const value = String(candidate || '').trim()
  // new URL('', base) resolves to the base itself, which turned every empty
  // src/content attribute into a "candidate" pointing at the article page.
  if (!value) return ''
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return ''
  }
}

function isSameDocument(url, pageUrl) {
  try {
    const candidate = new URL(url)
    const page = new URL(pageUrl)
    candidate.hash = ''
    page.hash = ''
    return candidate.toString() === page.toString()
  } catch {
    return false
  }
}

// `src="."` / `src="./"` resolve to a directory, never to an image file.
function looksLikeDirectoryUrl(url) {
  try {
    const pathname = new URL(url).pathname
    return pathname === '' || pathname.endsWith('/')
  } catch {
    return true
  }
}

function parseAttrs(attrText) {
  const attrs = {}
  // Values may be double-quoted, single-quoted, unquoted (<img src=https://…>)
  // or absent (boolean attributes). The previous quoted-only pattern silently
  // produced empty attribute maps for perfectly ordinary markup.
  const pattern = /([:@\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g
  let match = pattern.exec(attrText)
  while (match) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[match[1].toLowerCase()] = value
    match = pattern.exec(attrText)
  }
  return attrs
}

function parseSrcset(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, descriptor = ''] = entry.split(/\s+/)
      const width = /^(\d+)w$/i.exec(descriptor)
      const density = /^([\d.]+)x$/i.exec(descriptor)
      return {
        url: String(url || '').trim(),
        width: width ? Number(width[1]) : 0,
        density: density ? Number(density[1]) : 0,
      }
    })
    .filter((entry) => entry.url)
}

// Modern news sites publish responsive images only through srcset; picking the
// largest descriptor keeps the article-quality asset instead of a thumbnail.
function bestSrcsetEntry(value) {
  let best = null
  for (const entry of parseSrcset(value)) {
    if (!best) {
      best = entry
      continue
    }
    if (entry.width !== best.width) {
      if (entry.width > best.width) best = entry
      continue
    }
    if (entry.density > best.density) best = entry
  }
  return best
}

function shouldDropCandidate(candidate, rules) {
  const blocklist = (rules.blocklist_keywords || []).map((item) => String(item).toLowerCase())
  const haystack = `${candidate.url} ${candidate.alt} ${candidate.className}`.toLowerCase()
  if (!candidate.url) return true
  if (candidate.width && candidate.width < (rules.min_width || 0)) return true
  if (candidate.height && candidate.height < (rules.min_height || 0)) return true
  return blocklist.some((keyword) => haystack.includes(keyword))
}

export function extractImageCandidatesFromHtml(html, pageUrl) {
  const candidates = []
  const seen = new Set()
  const push = (candidate) => {
    if (!candidate.url) return
    // The page URL itself is not an image; it used to win scoring outright
    // because the slug repeats the topic terms, wasting a maxImages slot.
    if (isSameDocument(candidate.url, pageUrl)) return
    if (looksLikeDirectoryUrl(candidate.url)) return
    if (seen.has(candidate.url)) return
    seen.add(candidate.url)
    candidates.push(candidate)
  }

  const metaPattern = /<meta\s+([^>]+?)\/?>/gi
  let metaMatch = metaPattern.exec(html)
  while (metaMatch) {
    const attrs = parseAttrs(metaMatch[1])
    const property = (attrs.property || attrs.name || '').toLowerCase()
    if (property === 'og:image' || property === 'twitter:image') {
      push({
        url: absoluteUrl(pageUrl, attrs.content || ''),
        alt: '',
        width: 0,
        height: 0,
        className: 'meta-image',
        kind: 'meta-image',
      })
    }
    metaMatch = metaPattern.exec(html)
  }

  const sourcePattern = /<source\s+([^>]+?)\/?>/gi
  let sourceMatch = sourcePattern.exec(html)
  while (sourceMatch) {
    const attrs = parseAttrs(sourceMatch[1])
    const best = bestSrcsetEntry(attrs.srcset || attrs['data-srcset'] || '')
    if (best) {
      push({
        url: absoluteUrl(pageUrl, best.url),
        alt: '',
        width: best.width || 0,
        height: 0,
        className: attrs.class || 'picture-source',
        kind: 'inline-image',
      })
    }
    sourceMatch = sourcePattern.exec(html)
  }

  const imgPattern = /<img\s+([^>]+?)\/?>/gi
  let imgMatch = imgPattern.exec(html)
  while (imgMatch) {
    const attrs = parseAttrs(imgMatch[1])
    const bestFromSrcset = bestSrcsetEntry(attrs.srcset || attrs['data-srcset'] || '')
    const src = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || bestFromSrcset?.url || ''
    push({
      url: absoluteUrl(pageUrl, src),
      alt: attrs.alt || attrs.title || '',
      width: Number(attrs.width || 0) || bestFromSrcset?.width || 0,
      height: Number(attrs.height || 0),
      className: attrs.class || '',
      kind: 'inline-image',
    })
    if (bestFromSrcset && (attrs.src || attrs['data-src'] || attrs['data-lazy-src'])) {
      push({
        url: absoluteUrl(pageUrl, bestFromSrcset.url),
        alt: attrs.alt || attrs.title || '',
        width: Number(attrs.width || 0) || bestFromSrcset.width || 0,
        height: Number(attrs.height || 0),
        className: attrs.class || '',
        kind: 'inline-image',
      })
    }
    imgMatch = imgPattern.exec(html)
  }

  return candidates
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function candidateLooksHero(candidate) {
  return candidate.kind === 'meta-image'
    || candidate.className.includes('hero')
    || candidate.className.includes('featured')
    || candidate.width >= 960
    || candidate.height >= 540
}

function scoreCandidate(candidate, sectionHeading, topic, sourceItem = {}) {
  const haystack = `${candidate.alt} ${candidate.url} ${candidate.className}`.toLowerCase()
  const sourceHaystack = `${sourceItem.title || ''} ${sourceItem.source_name || ''} ${sourceItem.summary || ''}`.toLowerCase()
  const sectionTerms = tokenize(sectionHeading)
  const topicTerms = tokenize(topic)

  let score = 0
  if (candidate.kind === 'meta-image') score += 0.32
  if (candidateLooksHero(candidate)) score += 0.18
  if (candidate.width >= 600 || candidate.height >= 300) score += 0.16
  if (candidate.alt) score += 0.03
  if (sourceItem.is_primary) score += 0.03

  for (const term of sectionTerms) {
    if (!term) continue
    if (haystack.includes(term)) score += 0.14
    else if (sourceHaystack.includes(term)) score += 0.06
  }

  for (const term of topicTerms) {
    if (!term) continue
    if (haystack.includes(term)) score += 0.08
    else if (sourceHaystack.includes(term)) score += 0.03
  }
  return Number(score.toFixed(3))
}

async function fetchPageHtml(url, {
  fetchImpl,
  pinAddresses,
  lookupImpl,
  logger,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
} = {}) {
  // Source pages and every redirect target are DNS-checked before fetching.
  const { response: resp } = await fetchPublicResource(url, {
    userAgent: 'AutoBlogImagePicker/1.0',
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    fetchImpl,
    pinAddresses,
    lookupImpl,
    logger,
  })
  if (!resp.ok) {
    throw new Error(`image-page:${resp.status}`)
  }
  const body = await readLimitedResponseBody(resp, maxHtmlBytes)
  return body.toString('utf8')
}

export async function pickSourceImages({
  sections,
  topic,
  sourceItems,
  config,
  fetchImpl,
  pinAddresses,
  lookupImpl,
  logger = console,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
}) {
  const rules = config.image_selection_rules || {}
  const maxImages = Math.max(0, rules.max_images || 0)
  if (!Array.isArray(sections) || sections.length === 0 || maxImages === 0) {
    return []
  }

  const plans = []
  const usedUrls = new Set()
  const candidatesBySource = []
  const skippedSources = []

  for (const item of sourceItems || []) {
    try {
      const html = await fetchPageHtml(item.url, { fetchImpl, pinAddresses, lookupImpl, logger, maxHtmlBytes })
      const candidates = extractImageCandidatesFromHtml(html, item.url)
        .filter((candidate) => !shouldDropCandidate(candidate, rules))
        // The chosen image_url is fetched again later (download/upload), so a candidate
        // pointing at a private/internal host is the same SSRF vector as the page itself.
        .filter((candidate) => isPublicHttpUrl(candidate.url))
      candidatesBySource.push({ item, candidates })
    } catch (error) {
      // Silently swallowing this made "the source site is down" and "the URL was
      // blocked by the SSRF guard" indistinguishable in CI logs.
      const reason = error?.message || 'source page fetch failed'
      skippedSources.push({ url: item?.url || '', reason })
      logger?.warn?.(`Image picking skipped source page (${item?.url || 'unknown'}): ${reason}`)
    }
  }

  if (skippedSources.length > 0) {
    logger?.warn?.(`Image picking could not read ${skippedSources.length}/${(sourceItems || []).length} source page(s).`)
  }

  for (const sectionHeading of sections.slice(0, maxImages)) {
    let bestPlan = null
    let primaryFallbackPlan = null
    for (const source of candidatesBySource) {
      for (const candidate of source.candidates) {
        if (usedUrls.has(candidate.url)) continue
        const score = scoreCandidate(candidate, sectionHeading, topic, source.item)
        const plan = {
          section_heading: sectionHeading,
          image_url: candidate.url,
          source_page_url: source.item.url,
          source_name: source.item.source_name,
          reason: `matched:${sectionHeading}`,
          alt_text: candidate.alt || source.item.title,
          score,
        }
        if (!bestPlan || score > bestPlan.score) {
          bestPlan = plan
        }
        if (
          source.item?.is_primary
          && candidateLooksHero(candidate)
          && (!primaryFallbackPlan || score > primaryFallbackPlan.score)
        ) {
          primaryFallbackPlan = {
            ...plan,
            reason: `primary_hero_fallback:${sectionHeading}`,
          }
        }
      }
    }

    const selectedPlan = bestPlan && bestPlan.score > 0.18
      ? bestPlan
      : (plans.length === 0 && primaryFallbackPlan && primaryFallbackPlan.score >= 0.08
        ? primaryFallbackPlan
        : null)

    if (selectedPlan) {
      usedUrls.add(selectedPlan.image_url)
      plans.push(selectedPlan)
    }
  }

  return plans
}
