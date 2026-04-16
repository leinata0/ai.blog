function absoluteUrl(baseUrl, candidate) {
  try {
    return new URL(candidate, baseUrl).toString()
  } catch {
    return ''
  }
}

function parseAttrs(attrText) {
  const attrs = {}
  const pattern = /([:@\w-]+)\s*=\s*["']([^"']+)["']/g
  let match = pattern.exec(attrText)
  while (match) {
    attrs[match[1].toLowerCase()] = match[2]
    match = pattern.exec(attrText)
  }
  return attrs
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
  const metaPattern = /<meta\s+([^>]+)>/gi
  let metaMatch = metaPattern.exec(html)
  while (metaMatch) {
    const attrs = parseAttrs(metaMatch[1])
    const property = (attrs.property || attrs.name || '').toLowerCase()
    if (property === 'og:image' || property === 'twitter:image') {
      candidates.push({
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

  const imgPattern = /<img\s+([^>]+)>/gi
  let imgMatch = imgPattern.exec(html)
  while (imgMatch) {
    const attrs = parseAttrs(imgMatch[1])
    const src = attrs.src || attrs['data-src'] || attrs['data-lazy-src'] || ''
    candidates.push({
      url: absoluteUrl(pageUrl, src),
      alt: attrs.alt || attrs.title || '',
      width: Number(attrs.width || 0),
      height: Number(attrs.height || 0),
      className: attrs.class || '',
      kind: 'inline-image',
    })
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

async function fetchPageHtml(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'AutoBlogImagePicker/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`image-page:${resp.status}`)
  }
  return resp.text()
}

export async function pickSourceImages({
  sections,
  topic,
  sourceItems,
  config,
}) {
  const rules = config.image_selection_rules || {}
  const maxImages = Math.max(0, rules.max_images || 0)
  if (!Array.isArray(sections) || sections.length === 0 || maxImages === 0) {
    return []
  }

  const plans = []
  const usedUrls = new Set()
  const candidatesBySource = []

  for (const item of sourceItems || []) {
    try {
      const html = await fetchPageHtml(item.url)
      const candidates = extractImageCandidatesFromHtml(html, item.url)
        .filter((candidate) => !shouldDropCandidate(candidate, rules))
      candidatesBySource.push({ item, candidates })
    } catch {
      continue
    }
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
