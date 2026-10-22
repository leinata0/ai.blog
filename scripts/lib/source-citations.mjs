// Read balanced Markdown delimiters without imposing a nesting limit on URLs.
function balancedEnd(text, start, opening, closing) {
  let depth = 0
  for (let at = start; at < text.length; at += 1) {
    if (text[at] === '\\') {
      at += 1
    } else if (text[at] === opening) {
      depth += 1
    } else if (text[at] === closing && --depth === 0) {
      return at + 1
    }
  }
  return -1
}

function codeSpanEnd(text, start) {
  let length = 1
  while (text[start + length] === '`') length += 1
  let next = text.indexOf('`', start + length)
  while (next !== -1) {
    let closingLength = 1
    while (text[next + closingLength] === '`') closingLength += 1
    if (closingLength === length) return next + length
    next = text.indexOf('`', next + closingLength)
  }
  return -1
}

function fencedBlockEnd(text, start) {
  const lineEnd = text.indexOf('\n', start)
  const openingLine = text.slice(start, lineEnd === -1 ? text.length : lineEnd)
  const opening = openingLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
  if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) return -1
  const marker = opening[1][0]
  const minimumLength = opening[1].length
  let at = lineEnd === -1 ? text.length : lineEnd + 1
  while (at < text.length) {
    const nextLineEnd = text.indexOf('\n', at)
    const end = nextLineEnd === -1 ? text.length : nextLineEnd + 1
    const closing = text.slice(at, end).match(/^ {0,3}(`+|~+)[ \t\r\n]*$/)
    if (closing && closing[1][0] === marker && closing[1].length >= minimumLength) return end
    at = end
  }
  return text.length // An unclosed fence still makes the rest of the document code.
}

// Both normalization and validation use these same spans. Images, code examples,
// escaped markers and unrelated link destinations cannot be source citations.
function* sourceCitationSpans(text) {
  let at = 0
  while (at < text.length) {
    if (at === 0 || text[at - 1] === '\n') {
      const fenceEnd = fencedBlockEnd(text, at)
      if (fenceEnd !== -1) {
        at = fenceEnd
        continue
      }
    }
    if (text[at] === '\\') {
      at += 2
      continue
    }
    if (text[at] === '`') {
      const codeEnd = codeSpanEnd(text, at)
      if (codeEnd !== -1) {
        at = codeEnd
        continue
      }
      // An unmatched delimiter run is literal text; do not treat its suffix as
      // a shorter opener that might accidentally hide a real citation later.
      while (text[at] === '`') at += 1
      continue
    }
    const image = text[at] === '!' && text[at + 1] === '['
    const bracketStart = image ? at + 1 : at
    if (text[bracketStart] !== '[') {
      at += 1
      continue
    }
    const labelEnd = balancedEnd(text, bracketStart, '[', ']')
    if (labelEnd === -1) {
      at += 1
      continue
    }
    const label = text.slice(bracketStart + 1, labelEnd - 1)
    const hasDestination = text[labelEnd] === '('
    const imageReference = image && text[labelEnd] === '['
    const destinationEnd = hasDestination
      ? balancedEnd(text, labelEnd, '(', ')')
      : imageReference ? balancedEnd(text, labelEnd, '[', ']') : labelEnd
    const malformed = destinationEnd === -1
    const end = malformed ? text.length : destinationEnd
    if (!image && /^S\d+$/.test(label)) {
      yield {
        start: at,
        end,
        id: label,
        destination: hasDestination && !malformed ? text.slice(labelEnd + 1, end - 1) : undefined,
        malformed,
      }
    }
    at = end
  }
}

function sourceUrl(value) {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value.trim().replace(/^<|>$/g, ''))
    if (!['https:', 'http:'].includes(url.protocol)) return ''
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29')
  } catch {
    return ''
  }
}

function sourceMap(researchPack) {
  return new Map((researchPack?.sources || []).map((source) => [source.source_id, source]))
}

export function linkSourceCitations(contentMd, researchPack) {
  const sources = sourceMap(researchPack)
  const text = String(contentMd || '')
  const parts = []
  let previousEnd = 0
  for (const citation of sourceCitationSpans(text)) {
    parts.push(text.slice(previousEnd, citation.start))
    const url = sourceUrl(sources.get(citation.id)?.url)
    parts.push(url && !citation.malformed ? `[${citation.id}](${url})` : text.slice(citation.start, citation.end))
    previousEnd = citation.end
  }
  parts.push(text.slice(previousEnd))
  return parts.join('')
}

export function findInvalidCitationLinks(contentMd, researchPack) {
  const sources = sourceMap(researchPack)
  const invalid = new Set()
  for (const citation of sourceCitationSpans(String(contentMd || ''))) {
    const source = sources.get(citation.id)
    if (!source) continue // Unknown IDs are reported by the gate's existing check.
    const expected = sourceUrl(source.url)
    if (citation.malformed || !expected || (citation.destination !== undefined && sourceUrl(citation.destination) !== expected)) {
      invalid.add(citation.id)
    }
  }
  return [...invalid]
}
