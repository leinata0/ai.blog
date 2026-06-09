function stripMarkdown(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/^#+\s+/gm, '')
    .replace(/[>*_\-|]/g, ' ')
    .replace(/\s+/g, '')
}

function countPhraseHits(text, phrases) {
  return phrases.reduce((total, phrase) => {
    const safe = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = String(text || '').match(new RegExp(safe, 'g'))
    return total + (matches ? matches.length : 0)
  }, 0)
}

function countAnalysisSignals(text, signals) {
  return signals.reduce((count, signal) => {
    const safe = signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matches = String(text || '').match(new RegExp(safe, 'g'))
    return count + Math.min(matches ? matches.length : 0, 3)
  }, 0)
}

function hasSection(text, heading) {
  return String(text || '').includes(heading)
}

function resolveGateConfig(config, post) {
  const root = config.quality_gate || {}
  const gateKey = post?.gate_profile || post?.content_type || ''
  if (gateKey && root[gateKey] && typeof root[gateKey] === 'object') {
    return root[gateKey]
  }
  return root
}

function extractCitationIds(text) {
  const ids = []
  const regex = /\[(S\d+)\]/g
  let match = regex.exec(String(text || ''))
  while (match) {
    ids.push(match[1])
    match = regex.exec(String(text || ''))
  }
  return ids
}

function sourceIdMap(researchPack) {
  return new Map((researchPack?.sources || [])
    .filter((item) => item?.source_id)
    .map((item) => [item.source_id, item]))
}

function domainFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return ''
  }
}

function extractSections(text, headings) {
  const lines = String(text || '').split('\n')
  const headingIndexes = (headings || [])
    .map((heading) => ({ heading, index: lines.findIndex((line) => line.trim() === String(heading).trim()) }))
    .filter((entry) => entry.index >= 0)

  return headingIndexes.map((entry, index) => {
    const next = headingIndexes[index + 1]
    const end = next ? next.index : lines.length
    const markdown = lines.slice(entry.index, end).join('\n')
    return { heading: entry.heading, markdown, plain: stripMarkdown(markdown) }
  })
}

function countDuplicateHeadings(text) {
  const counts = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^##\s+(.+)$/)
    if (!match) continue
    const heading = match[0].trim()
    counts.set(heading, (counts.get(heading) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([heading]) => heading)
}

function countRepeatedLongLines(text) {
  const counts = new Map()
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (line.length < 28 || line.startsWith('#') || line.startsWith('- ') || line.startsWith('>')) continue
    counts.set(line, (counts.get(line) || 0) + 1)
  }
  return [...counts.values()].filter((count) => count > 1).length
}

export function evaluateQualityGate({
  post,
  researchPack,
  formatProfile,
  config,
}) {
  const gate = resolveGateConfig(config, post)
  const content = String(post?.content_md || '')
  const plain = stripMarkdown(content)
  const allSources = researchPack?.sources || []
  const highQualityTypes = new Set(gate.high_quality_source_types || [])
  const highQualitySources = allSources.filter((item) => highQualityTypes.has(item.source_type))
  const bannedPhraseHits = countPhraseHits(content, formatProfile.banned_phrases || [])
  const analysisSignals = countAnalysisSignals(content, formatProfile.analysis_markers || [])
  const requiredSections = formatProfile.required_sections || []
  const missingSections = [
    ...requiredSections,
    ...(formatProfile.required_tail_sections || []),
  ].filter((heading) => !hasSection(content, heading))
  const sourceMap = sourceIdMap(researchPack)
  const citationIds = extractCitationIds(content)
  const uniqueCitationIds = [...new Set(citationIds)]
  const invalidCitationIds = uniqueCitationIds.filter((id) => !sourceMap.has(id))
  const citedSources = uniqueCitationIds.map((id) => sourceMap.get(id)).filter(Boolean)
  const citedDomains = [...new Set(citedSources.map((item) => item.domain || domainFromUrl(item.url)).filter(Boolean))]
  const sections = extractSections(content, requiredSections)
  const sectionsWithoutCitations = sections
    .filter((section) => extractCitationIds(section.markdown).length === 0)
    .map((section) => section.heading)
  const minSectionChars = Math.max(0, Number(gate.min_section_chars || 0))
  const thinSections = minSectionChars > 0
    ? sections.filter((section) => section.plain.length < minSectionChars).map((section) => `${section.heading}:${section.plain.length}`)
    : []
  const duplicateHeadings = countDuplicateHeadings(content)
  const repeated_long_line_count = countRepeatedLongLines(content)

  const reasons = []

  if (allSources.length < (gate.min_sources || 0)) {
    reasons.push(`sources:${allSources.length}<${gate.min_sources}`)
  }
  if (highQualitySources.length < (gate.min_high_quality_sources || 0)) {
    reasons.push(`high_quality_sources:${highQualitySources.length}<${gate.min_high_quality_sources}`)
  }
  if (plain.length < (gate.min_chars || 0)) {
    reasons.push(`chars:${plain.length}<${gate.min_chars}`)
  }
  if (bannedPhraseHits > (gate.max_banned_phrase_hits || 0)) {
    reasons.push(`banned_phrases:${bannedPhraseHits}>${gate.max_banned_phrase_hits}`)
  }
  if (analysisSignals < (gate.min_analysis_signals || 0)) {
    reasons.push(`analysis_signals:${analysisSignals}<${gate.min_analysis_signals}`)
  }
  if (missingSections.length > 0) {
    reasons.push(`missing_sections:${missingSections.join('|')}`)
  }
  if (duplicateHeadings.length > 0) {
    reasons.push(`duplicate_headings:${duplicateHeadings.join('|')}`)
  }
  if (repeated_long_line_count > (gate.max_repeated_long_lines || 0)) {
    reasons.push(`repeated_lines:${repeated_long_line_count}>${gate.max_repeated_long_lines || 0}`)
  }
  if (invalidCitationIds.length > 0) {
    reasons.push(`invalid_citations:${invalidCitationIds.join('|')}`)
  }
  if (citationIds.length < (gate.min_inline_citations || 0)) {
    reasons.push(`citations:${citationIds.length}<${gate.min_inline_citations}`)
  }
  if (uniqueCitationIds.filter((id) => sourceMap.has(id)).length < (gate.min_cited_sources || 0)) {
    reasons.push(`cited_sources:${uniqueCitationIds.filter((id) => sourceMap.has(id)).length}<${gate.min_cited_sources}`)
  }
  if (citedDomains.length < (gate.min_cited_domains || 0)) {
    reasons.push(`cited_domains:${citedDomains.length}<${gate.min_cited_domains}`)
  }
  if (gate.require_section_citations && sectionsWithoutCitations.length > 0) {
    reasons.push(`section_citations:${sectionsWithoutCitations.join('|')}`)
  }
  if (thinSections.length > 0) {
    reasons.push(`thin_sections:${thinSections.join('|')}`)
  }

  return {
    passed: reasons.length === 0,
    reasons,
    metrics: {
      source_count: allSources.length,
      high_quality_source_count: highQualitySources.length,
      char_count: plain.length,
      banned_phrase_hits: bannedPhraseHits,
      analysis_signal_count: analysisSignals,
      missing_sections: missingSections,
      inline_citation_count: citationIds.length,
      cited_source_count: uniqueCitationIds.filter((id) => sourceMap.has(id)).length,
      cited_domain_count: citedDomains.length,
      invalid_citation_markers: invalidCitationIds,
      sections_without_citations: sectionsWithoutCitations,
      duplicate_headings: duplicateHeadings,
      repeated_long_line_count,
      thin_sections: thinSections,
    },
  }
}

export function formatQualityGateReport(result) {
  if (result.passed) {
    return `passed sources=${result.metrics.source_count} chars=${result.metrics.char_count} citations=${result.metrics.inline_citation_count}`
  }
  return `failed ${result.reasons.join(', ')}`
}
