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

  return headingIndexes.map((entry) => {
    const laterHeadingIndex = lines.findIndex((line, index) => index > entry.index && /^##\s+/.test(line.trim()))
    const end = laterHeadingIndex >= 0 ? laterHeadingIndex : lines.length
    const markdown = lines.slice(entry.index, end).join('\n')
    return { heading: entry.heading, markdown, plain: stripMarkdown(markdown) }
  })
}

// Slice an article into sections by its ACTUAL level-2 headings, without needing a
// predefined heading list. Used by free-structure mode where the LLM authors its own
// chapter titles. `excludeHeadings` drops program-appended tail blocks (参考来源/图片来源/
// 一句话结论) so body-section counts and per-section checks only see authored chapters.
function extractAllSections(text, excludeHeadings = []) {
  const lines = String(text || '').split('\n')
  const exclude = new Set((excludeHeadings || []).map((heading) => String(heading || '').trim()))
  const headingIndexes = []
  for (let index = 0; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      headingIndexes.push(index)
    }
  }

  return headingIndexes
    .map((startIndex, order) => {
      const end = order + 1 < headingIndexes.length ? headingIndexes[order + 1] : lines.length
      const heading = lines[startIndex].trim()
      const markdown = lines.slice(startIndex, end).join('\n')
      return { heading, markdown, plain: stripMarkdown(markdown) }
    })
    .filter((section) => !exclude.has(section.heading))
}

function countDuplicateHeadings(text, headings = null) {
  const required = headings ? new Set(headings.map((heading) => String(heading || '').trim())) : null
  const counts = new Map()
  for (const line of String(text || '').split('\n')) {
    const match = line.match(/^##\s+(.+)$/)
    if (!match) continue
    const heading = match[0].trim()
    if (required && !required.has(heading)) continue
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

function countParagraphs(markdown) {
  return String(markdown || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('#') && !part.startsWith('- ') && !part.startsWith('!['))
    .length
}

function countSubheadings(markdown) {
  const matches = String(markdown || '').match(/^###\s+.+$/gm)
  return matches ? matches.length : 0
}

function countShortParagraphRatio(markdown) {
  const paragraphs = String(markdown || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('#') && !part.startsWith('- ') && !part.startsWith('!['))
  if (paragraphs.length === 0) return 0
  const shortCount = paragraphs.filter((part) => stripMarkdown(part).length < 80).length
  return shortCount / paragraphs.length
}

function listOnlySections(sections) {
  return sections
    .filter((section) => {
      const lines = String(section.markdown || '').split('\n').map((line) => line.trim()).filter(Boolean)
      const bodyLines = lines.filter((line) => !line.startsWith('#'))
      if (bodyLines.length < 4) return false
      const listLines = bodyLines.filter((line) => /^[-*+]\s+|^\d+[.)]\s+/.test(line))
      return listLines.length / bodyLines.length > 0.65
    })
    .map((section) => section.heading)
}

function countSectionAnalysis(sections, signals) {
  return sections.filter((section) => countAnalysisSignals(section.markdown, signals) > 0).length
}

function countBodySourceMentions(content, sources, validCitationIds) {
  const referenceStart = String(content || '').indexOf('## 参考来源')
  const body = referenceStart >= 0 ? String(content).slice(0, referenceStart) : String(content || '')
  const names = new Set()
  for (const source of sources || []) {
    const sourceName = String(source?.source_name || '').trim()
    if (sourceName && body.includes(sourceName)) names.add(sourceName)
    const title = String(source?.title || '').trim()
    if (title && title.length >= 8 && body.includes(title.slice(0, Math.min(24, title.length)))) names.add(title)
  }
  return new Set([...names, ...(validCitationIds || [])]).size
}

function countEvidenceCards(researchPack, post) {
  const cards = Array.isArray(researchPack?.evidence_cards)
    ? researchPack.evidence_cards
    : Array.isArray(post?.evidence_cards)
      ? post.evidence_cards
      : []
  return cards.length
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
  const isFreeStructure = formatProfile.structure_mode === 'free'
  const tailSections = formatProfile.required_tail_sections || []
  const requiredSections = formatProfile.required_sections || []
  // Free mode: the LLM authors its own chapter titles, so there is no fixed list to
  // diff against. Body sections are everything except the program-appended tail blocks.
  // Fixed mode: byte-for-byte unchanged — slice by the predefined required headings.
  const sections = isFreeStructure
    ? extractAllSections(content, tailSections)
    : extractSections(content, requiredSections)
  const missingSections = isFreeStructure
    ? tailSections.filter((heading) => !hasSection(content, heading))
    : [
        ...requiredSections,
        ...tailSections,
      ].filter((heading) => !hasSection(content, heading))
  const sourceMap = sourceIdMap(researchPack)
  const citationIds = extractCitationIds(content)
  const uniqueCitationIds = [...new Set(citationIds)]
  const invalidCitationIds = uniqueCitationIds.filter((id) => !sourceMap.has(id))
  const citedSources = uniqueCitationIds.map((id) => sourceMap.get(id)).filter(Boolean)
  const citedDomains = [...new Set(citedSources.map((item) => item.domain || domainFromUrl(item.url)).filter(Boolean))]
  const sectionsWithoutCitations = sections
    .filter((section) => extractCitationIds(section.markdown).length === 0)
    .map((section) => section.heading)
  const minSectionChars = Math.max(0, Number(gate.min_section_chars || 0))
  const thinSections = minSectionChars > 0
    ? sections.filter((section) => section.plain.length < minSectionChars).map((section) => `${section.heading}:${section.plain.length}`)
    : []
  const minSectionParagraphs = Math.max(0, Number(gate.min_section_paragraphs || 0))
  const sectionParagraphCounts = Object.fromEntries(sections.map((section) => [section.heading, countParagraphs(section.markdown)]))
  const sectionsWithFewParagraphs = minSectionParagraphs > 0
    ? sections.filter((section) => sectionParagraphCounts[section.heading] < minSectionParagraphs).map((section) => `${section.heading}:${sectionParagraphCounts[section.heading]}`)
    : []
  const subheadingCount = countSubheadings(content)
  const minSubheadings = Math.max(0, Number(gate.min_subheadings || 0))
  const analysisSectionCount = countSectionAnalysis(sections, formatProfile.analysis_markers || [])
  const minAnalysisSections = Math.max(0, Number(gate.min_analysis_sections || 0))
  const bodySourceMentionCount = countBodySourceMentions(content, allSources, uniqueCitationIds.filter((id) => sourceMap.has(id)))
  const minBodySourceMentions = Math.max(0, Number(gate.min_body_source_mentions || 0))
  const evidenceCardCount = countEvidenceCards(researchPack, post)
  const minEvidenceCards = Math.max(0, Number(gate.min_evidence_cards || 0))
  const shortParagraphRatio = countShortParagraphRatio(content)
  const maxShortParagraphRatio = Number(gate.max_short_paragraph_ratio || 0)
  const listOnlySectionHeadings = listOnlySections(sections)
  const maxListOnlySections = Number.isFinite(Number(gate.max_list_only_sections)) ? Number(gate.max_list_only_sections) : 0
  const sectionCharCounts = sections.map((section) => section.plain.length).filter((count) => count > 0)
  const sectionCharRatio = sectionCharCounts.length > 1
    ? Math.max(...sectionCharCounts) / Math.max(1, Math.min(...sectionCharCounts))
    : 1
  const maxSectionCharRatio = Number(gate.max_section_char_ratio || 0)
  // Fixed mode: only required/tail headings can legitimately repeat, so scope the check
  // to them. Free mode: the LLM authors titles, so any duplicated H2 is a real defect.
  const duplicateHeadings = isFreeStructure
    ? countDuplicateHeadings(content)
    : countDuplicateHeadings(content, [
        ...requiredSections,
        ...tailSections,
      ])
  const repeated_long_line_count = countRepeatedLongLines(content)

  // Free-structure dimension coverage: instead of diffing against fixed headings, verify
  // the article fulfills the editorial dimensions it must cover, using signals already
  // computed above. Each dimension maps to an objective, machine-checkable proxy.
  const requiredDimensions = isFreeStructure
    ? (Array.isArray(formatProfile.required_dimensions) && formatProfile.required_dimensions.length > 0
        ? formatProfile.required_dimensions
        : (Array.isArray(gate.required_dimensions) ? gate.required_dimensions : []))
    : []
  const judgmentMarkerHit = /##\s*一句话结论/.test(content) || analysisSignals > 0
  const dimensionSatisfied = {
    facts: citationIds.length >= Math.max(1, Number(gate.min_inline_citations || 1)),
    significance: analysisSectionCount >= 1 || analysisSignals >= Math.max(1, Number(gate.min_analysis_signals || 1)),
    multi_source: citedDomains.length >= Math.max(1, Number(gate.min_cited_domains || 1)),
    analysis: analysisSectionCount >= Math.max(1, Number(gate.min_analysis_sections || 1)),
    judgment: judgmentMarkerHit,
  }
  const missingDimensions = requiredDimensions.filter((dimension) => !dimensionSatisfied[dimension])
  // Body section count guard (free mode only): too few means it collapsed into one block,
  // too many means it fragmented into a news list. Tail blocks are excluded from `sections`.
  const bodySectionCount = isFreeStructure ? sections.length : null
  const minSections = Math.max(0, Number(gate.min_sections || 0))
  const maxSections = Number.isFinite(Number(gate.max_sections)) && Number(gate.max_sections) > 0
    ? Number(gate.max_sections)
    : 0

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
  if (isFreeStructure && missingDimensions.length > 0) {
    reasons.push(`missing_dimensions:${missingDimensions.join('|')}`)
  }
  if (isFreeStructure && minSections > 0 && bodySectionCount < minSections) {
    reasons.push(`section_count:${bodySectionCount}<${minSections}`)
  }
  if (isFreeStructure && maxSections > 0 && bodySectionCount > maxSections) {
    reasons.push(`section_count:${bodySectionCount}>${maxSections}`)
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
  if (sectionsWithFewParagraphs.length > 0) {
    reasons.push(`section_paragraphs:${sectionsWithFewParagraphs.join('|')}`)
  }
  if (minSubheadings > 0 && subheadingCount < minSubheadings) {
    reasons.push(`subheadings:${subheadingCount}<${minSubheadings}`)
  }
  if (minAnalysisSections > 0 && analysisSectionCount < minAnalysisSections) {
    reasons.push(`analysis_sections:${analysisSectionCount}<${minAnalysisSections}`)
  }
  if (minBodySourceMentions > 0 && bodySourceMentionCount < minBodySourceMentions) {
    reasons.push(`body_source_mentions:${bodySourceMentionCount}<${minBodySourceMentions}`)
  }
  if (minEvidenceCards > 0 && evidenceCardCount < minEvidenceCards) {
    reasons.push(`evidence_cards:${evidenceCardCount}<${minEvidenceCards}`)
  }
  if (maxShortParagraphRatio > 0 && shortParagraphRatio > maxShortParagraphRatio) {
    reasons.push(`short_paragraph_ratio:${shortParagraphRatio.toFixed(2)}>${maxShortParagraphRatio}`)
  }
  if (maxSectionCharRatio > 0 && sectionCharRatio > maxSectionCharRatio) {
    reasons.push(`section_char_ratio:${sectionCharRatio.toFixed(2)}>${maxSectionCharRatio}`)
  }
  if (listOnlySectionHeadings.length > maxListOnlySections) {
    reasons.push(`list_only_sections:${listOnlySectionHeadings.join('|')}`)
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
      section_paragraph_counts: sectionParagraphCounts,
      sections_with_few_paragraphs: sectionsWithFewParagraphs,
      subheading_count: subheadingCount,
      analysis_section_count: analysisSectionCount,
      body_source_mention_count: bodySourceMentionCount,
      evidence_card_count: evidenceCardCount,
      short_paragraph_ratio: Number(shortParagraphRatio.toFixed(3)),
      section_char_ratio: Number(sectionCharRatio.toFixed(3)),
      list_only_sections: listOnlySectionHeadings,
      dimension_coverage: isFreeStructure
        ? Object.fromEntries(requiredDimensions.map((dimension) => [dimension, Boolean(dimensionSatisfied[dimension])]))
        : null,
      missing_dimensions: isFreeStructure ? missingDimensions : [],
      section_count: bodySectionCount,
    },
  }
}

export function formatQualityGateReport(result) {
  if (result.passed) {
    return `passed sources=${result.metrics.source_count} chars=${result.metrics.char_count} citations=${result.metrics.inline_citation_count}`
  }
  return `failed ${result.reasons.join(', ')}`
}
