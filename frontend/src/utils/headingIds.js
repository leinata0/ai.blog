/**
 * Shared heading id helpers so TOC and ArticleMarkdownRenderer stay in sync.
 */

export function slugifyHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Parse markdown for h2/h3 headings with unique ids (duplicate titles get -2, -3…).
 */
export function parseMarkdownHeadings(markdown) {
  if (!markdown) return []
  const lines = String(markdown).split('\n')
  const counts = Object.create(null)
  const headings = []

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (!match) continue
    const level = match[1].length
    if (level < 2) continue
    const text = match[2].replace(/[`*_~]/g, '').trim()
    if (!text) continue
    const base = slugifyHeading(text) || 'section'
    counts[base] = (counts[base] || 0) + 1
    const id = counts[base] === 1 ? base : `${base}-${counts[base]}`
    headings.push({ level, text, id })
  }

  return headings
}

/**
 * Factory for markdown heading components that assign unique ids in document order.
 */
export function createHeadingIdAllocator() {
  const counts = Object.create(null)
  return function allocateHeadingId(text) {
    const base = slugifyHeading(text) || 'section'
    counts[base] = (counts[base] || 0) + 1
    return counts[base] === 1 ? base : `${base}-${counts[base]}`
  }
}

/** Sticky chrome offset for scroll-into-view and active-section detection. */
export const READING_SCROLL_OFFSET_PX = 96
