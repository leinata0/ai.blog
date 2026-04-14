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
  return signals.reduce((count, signal) => (
    String(text || '').includes(signal) ? count + 1 : count
  ), 0)
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
  const missingSections = [
    ...(formatProfile.required_sections || []),
    ...(formatProfile.required_tail_sections || []),
  ].filter((heading) => !hasSection(content, heading))

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
    },
  }
}

export function formatQualityGateReport(result) {
  if (result.passed) {
    return `passed sources=${result.metrics.source_count} chars=${result.metrics.char_count}`
  }
  return `failed ${result.reasons.join(', ')}`
}
