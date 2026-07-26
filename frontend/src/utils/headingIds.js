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
 *每个 heading 带上源码行号，渲染端可以按行号反查同一份 id，避免两边各算一次。
 */
export function parseMarkdownHeadings(markdown) {
  if (!markdown) return []
  const lines = String(markdown).split('\n')
  const counts = Object.create(null)
  const headings = []
  let fenceMarker = ''

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    // ``` / ~~~ 围栏内的 "## xxx" 不是标题，跳过后 TOC 才不会出现点不动的幽灵条目。
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (!fenceMarker) {
        fenceMarker = fence[1][0]
      } else if (fence[1][0] === fenceMarker) {
        fenceMarker = ''
      }
      continue
    }
    if (fenceMarker) continue

    const match = line.match(/^(#{1,3})\s+(.+)$/)
    if (!match) continue
    const level = match[1].length
    if (level < 2) continue
    const text = match[2].replace(/[`*_~]/g, '').trim()
    if (!text) continue
    const base = slugifyHeading(text) || 'section'
    counts[base] = (counts[base] || 0) + 1
    const id = counts[base] === 1 ? base : `${base}-${counts[base]}`
    headings.push({ level, text, id, line: index + 1 })
  }

  return headings
}

/**
 * Factory for markdown heading components that assign unique ids in document order.
 *
 * 注意：返回的闭包持有可变计数器，只能在"一次完整的文档遍历"里使用。
 * React 组件渲染会重复执行，请改用 createHeadingIdLookup。
 */
export function createHeadingIdAllocator() {
  const counts = Object.create(null)
  return function allocateHeadingId(text) {
    const base = slugifyHeading(text) || 'section'
    counts[base] = (counts[base] || 0) + 1
    return counts[base] === 1 ? base : `${base}-${counts[base]}`
  }
}

/**
 * 纯查表版本：一次性算出 markdown 的 id 列表，渲染时按源码行号（首选）或标题文本反查。
 * 无内部可变状态，因此同一个 markdown 无论重渲染多少次都返回同一批 id，
 * 和 parseMarkdownHeadings（TOC 使用）产出的 id 必然一致。
 */
export function createHeadingIdLookup(markdown) {
  const headings = parseMarkdownHeadings(markdown)
  const byLine = new Map()
  const byText = new Map()

  for (const heading of headings) {
    byLine.set(heading.line, heading.id)
    if (!byText.has(heading.text)) byText.set(heading.text, heading.id)
  }

  return function lookupHeadingId(text, line) {
    if (Number.isFinite(line) && byLine.has(line)) return byLine.get(line)
    const normalized = String(text || '').trim()
    if (byText.has(normalized)) return byText.get(normalized)
    return slugifyHeading(normalized) || 'section'
  }
}

/** Sticky chrome offset for scroll-into-view and active-section detection. */
export const READING_SCROLL_OFFSET_PX = 96
