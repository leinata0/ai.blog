import { isPublicHttpUrl } from './url-guard.mjs'

// 供给侧修复。插图覆盖率低的一半原因是「图源只有一个」：唯一的候选来自事后再去抓源站
// 页面 HTML，而那一步会被 JS 注入正文、付费墙、反爬和超时打掉一大半。
//
// 但流水线其实早就把两份带图的正文拉回本地了，只是整段丢掉：
//   1) RSS 的 <content:encoded> / <description>（WordPress 系普遍给正文全文），
//   2) Jina 返回的 markdown（`![](...)` 直接被当纯文本处理）。
// 这两份数据天然属于「这一篇文章」，不是全站社交卡片，相关性也比 og:image 强得多。
//
// 本模块只做「解析 + 取 URL」：不执行、不请求、不信任任何第三方标记。产出的候选字段与
// source-image-picker.extractImageCandidatesFromHtml 一致，下游可以把三路图源合并后用
// 同一套规则过滤打分；候选 URL 仍然要走下游的 SSRF/尺寸/黑名单校验，这里不替它做主。

// 单个字段最多解析这么多字符。全文 feed 的 content:encoded 单条就能有几百 KB，
// 29 个源同时解析时必须有硬上限，否则一个异常源就能吃掉 worker 的内存。
const MAX_MARKUP_CHARS = 256 * 1024
// 单条 item 最多保留的候选数。一篇 WordPress 长文能带 40+ 张图，下游每篇只用 2-3 张，
// 多留下来的只是内存占用和排序噪声。
const MAX_CANDIDATES_PER_ITEM = 12
const MAX_ALT_CHARS = 240
const MAX_CONTEXT_CHARS = 240
// 取 <img> 前后各这么多字符做上下文。够覆盖相邻段落，又不至于把整篇正文拖进候选里。
const CONTEXT_WINDOW_CHARS = 700
// 明确声明 1x1（到 4x4）的是统计像素，不是插图。WordPress.com、FeedBurner、FeedPress
// 都会往 feed 正文尾部塞这种 beacon —— 它们只在 feed 里出现，页面侧的规则不认识。
const MIN_INTRINSIC_PIXELS = 5

// 这些主机在 feed 场景下只发计数 gif / 转跳图标，不会是正文插图。
const FEED_TRACKING_HOSTS = new Set([
  'assets.feedblitz.com',
  'da.feedsportal.com',
  'feedads.g.doubleclick.net',
  'feedpress.me',
  'feedproxy.google.com',
  'feeds.feedburner.com',
  'pixel.wp.com',
  'rss.feedsportal.com',
  'stats.wordpress.com',
])
// FeedBurner 的 `/~ff/<feed>?a=<id>:<hash>:<gif>` 和各家的空白像素。
const FEED_TRACKING_PATH_HINTS = ['/~ff/', '/~a/', '/~r/', '/b.gif', '/blank.gif', '/pixel.gif', '/spacer.gif']

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|avif|svg)(?:$|[?#])/i

const NAMED_HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
}

// 单次解码，和 source-image-picker 的约定一致：`&amp;#038;` 只还原成 `&#038;`，
// 不做二次展开。Jetpack 会把查询串分隔符写成 `&#038;`，不解就会被当成一个名叫
// `#038;ssl` 的参数，同一张图的两个 rendition 于是拿到两个不同的去重键。
export function decodeFeedEntities(value) {
  return String(value || '').replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity) => {
    const lower = entity.toLowerCase()
    if (lower[0] === '#') {
      const code = lower[1] === 'x' ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return Object.hasOwn(NAMED_HTML_ENTITIES, lower) ? NAMED_HTML_ENTITIES[lower] : match
  })
}

function collapseSpace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncate(value, max) {
  const text = collapseSpace(value)
  return text.length > max ? text.slice(0, max) : text
}

function stripTags(value) {
  return collapseSpace(decodeFeedEntities(String(value || '').replace(/<[^>]*>/g, ' ')))
}

// 第三方 HTML，只做剥离，绝不执行。注释里可能藏着编辑撤下的图，<script>/<style> 里
// 的 URL 不是插图，两者都清掉；<noscript> 反过来要保留内容 —— 懒加载站点习惯把真正的
// <img> 放在 <noscript> 里兜底，整段删掉等于把最可靠的那张图扔了。
function stripNonContentMarkup(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/?noscript[^>]*>/gi, ' ')
}

function parseAttrs(attrText) {
  const attrs = {}
  // 值可能是双引号、单引号、无引号（<img src=https://…>）或纯布尔属性。
  const pattern = /([:@\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g
  let match = pattern.exec(attrText)
  while (match) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[match[1].toLowerCase()] = decodeFeedEntities(value)
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

// feed 正文里的 src 经常是站内相对路径（`/wp-content/uploads/...`），baseUrl 就是这条
// item 的文章链接。解析不出绝对 http(s) URL 的一律丢弃：data:/cid: 内联图对下游的
// 「下载再上传 R2」流程没有意义，还会把几百 KB 的 base64 塞进候选列表。
function absoluteImageUrl(baseUrl, candidate) {
  const value = String(candidate || '').trim()
  if (!value) return ''
  let parsed
  try {
    parsed = baseUrl ? new URL(value, baseUrl) : new URL(value)
  } catch {
    return ''
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (!parsed.pathname || parsed.pathname.endsWith('/')) return ''
  return parsed.toString()
}

function isFeedTrackingUrl(url) {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
    if (FEED_TRACKING_HOSTS.has(host)) return true
    const path = parsed.pathname.toLowerCase()
    return FEED_TRACKING_PATH_HINTS.some((hint) => path.includes(hint))
  } catch {
    return true
  }
}

// 只在标记里「明确写出」尺寸时才判定为统计像素。没写宽高的一律放行，交给下游按
// min_width/min_height 以及 URL 内嵌尺寸去判断 —— 在这里猜等于替下游做主。
function isTrackingPixel(width, height) {
  if (width > 0 && width < MIN_INTRINSIC_PIXELS) return true
  return height > 0 && height < MIN_INTRINSIC_PIXELS
}

// <figure> 用栈式扫描，嵌套（图集里 figure 套 figure）也能正确闭合；被 MAX_MARKUP_CHARS
// 截断而未闭合的标签按「一直开到结尾」处理，宁可多给一个 figure 归属也不丢掉位置信号。
function collectFigureRanges(html) {
  const ranges = []
  const open = []
  const pattern = /<(\/?)figure(\s[^>]*)?>/gi
  let match = pattern.exec(html)
  while (match) {
    if (match[1] === '/') {
      const start = open.pop()
      if (start !== undefined) ranges.push({ start, end: match.index + match[0].length })
    } else {
      open.push(match.index)
    }
    match = pattern.exec(html)
  }
  while (open.length > 0) ranges.push({ start: open.pop(), end: html.length })

  return ranges.map((range) => {
    const inner = html.slice(range.start, range.end)
    const caption = /<figcaption[^>]*>([\s\S]*?)<\/figcaption\s*>/i.exec(inner)
    return {
      ...range,
      caption: caption ? truncate(stripTags(caption[1]), MAX_CONTEXT_CHARS) : '',
    }
  })
}

function figureAt(ranges, index) {
  // 最内层的 figure 才是这张图的说明，所以取跨度最小的那个。
  let found = null
  for (const range of ranges) {
    if (index < range.start || index >= range.end) continue
    if (!found || (range.end - range.start) < (found.end - found.start)) found = range
  }
  return found
}

// 图片周边的正文。中文章节标题 vs 英文图片 URL 的子串匹配命中率约等于零，而 figcaption
// 和相邻段落是这张图唯一一份自然语言描述 —— 相关性打分要真的生效，就得有这份文本。
function contextAt(html, index, length) {
  const before = stripTags(html.slice(Math.max(0, index - CONTEXT_WINDOW_CHARS), index))
  const after = stripTags(html.slice(index + length, index + length + CONTEXT_WINDOW_CHARS))
  const half = Math.floor(MAX_CONTEXT_CHARS / 2)
  return collapseSpace(`${before.slice(-half)} ${after.slice(0, half)}`)
}

function buildCandidate(fields) {
  return {
    url: fields.url,
    alt: truncate(fields.alt || '', MAX_ALT_CHARS),
    caption: truncate(fields.caption || '', MAX_CONTEXT_CHARS),
    context: truncate(fields.context || '', MAX_CONTEXT_CHARS),
    width: Number(fields.width) || 0,
    height: Number(fields.height) || 0,
    className: String(fields.className || ''),
    kind: fields.kind,
    origin: fields.origin,
    field: fields.field,
    inArticle: fields.inArticle !== false,
    inMain: fields.inMain !== false,
    inFigure: Boolean(fields.inFigure),
    hasCaption: Boolean(fields.hasCaption),
    responsive: Boolean(fields.responsive),
  }
}

/**
 * 从一段 HTML 片段（feed 正文 / summary）里提取图片候选。
 * 片段本身就是这篇文章的正文，所以 inArticle / inMain 默认为 true —— 这不是加分手段，
 * 而是对事实的如实标注：feed 正文里的图不可能是站点导航或全站分享卡。
 */
export function extractImageCandidatesFromMarkup(markup, baseUrl, {
  kind = 'feed-content',
  field = 'content:encoded',
  origin = 'feed',
  maxCandidates = MAX_CANDIDATES_PER_ITEM,
} = {}) {
  const raw = String(markup || '')
  if (!raw || !raw.includes('<')) return []
  const html = stripNonContentMarkup(raw.slice(0, MAX_MARKUP_CHARS))
  const figures = collectFigureRanges(html)
  const candidates = []
  const seen = new Set()

  const push = (fields) => {
    const url = absoluteImageUrl(baseUrl, fields.url)
    if (!url || seen.has(url)) return
    if (isFeedTrackingUrl(url)) return
    if (isTrackingPixel(Number(fields.width) || 0, Number(fields.height) || 0)) return
    if (!isPublicHttpUrl(url)) return
    seen.add(url)
    candidates.push(buildCandidate({ ...fields, url, kind, field, origin }))
  }

  // <picture><source srcset> 在全文 feed 里少见但不是没有（Ghost、Substack 都会出）。
  const sourcePattern = /<source\s+([^>]+?)\/?>/gi
  let sourceMatch = sourcePattern.exec(html)
  while (sourceMatch && candidates.length < maxCandidates) {
    const attrs = parseAttrs(sourceMatch[1])
    const best = bestSrcsetEntry(attrs.srcset || attrs['data-srcset'] || '')
    if (best) {
      const figure = figureAt(figures, sourceMatch.index)
      push({
        url: best.url,
        alt: '',
        caption: figure?.caption || '',
        context: contextAt(html, sourceMatch.index, sourceMatch[0].length),
        width: best.width || 0,
        height: 0,
        className: attrs.class || 'picture-source',
        inFigure: Boolean(figure),
        hasCaption: Boolean(figure?.caption),
        responsive: true,
      })
    }
    sourceMatch = sourcePattern.exec(html)
  }

  const imgPattern = /<img\s+([^>]+?)\/?>/gi
  let imgMatch = imgPattern.exec(html)
  while (imgMatch && candidates.length < maxCandidates) {
    const attrs = parseAttrs(imgMatch[1])
    const bestFromSrcset = bestSrcsetEntry(attrs.srcset || attrs['data-srcset'] || '')
    // 懒加载属性的覆盖面比页面侧更广：中文源站（36 氪、雷峰网、少数派）在 feed 正文里
    // 同样会把真实地址放进 data-original / data-actualsrc，而 src 只是一张占位图。
    const lazySrc = attrs['data-src']
      || attrs['data-lazy-src']
      || attrs['data-original']
      || attrs['data-actualsrc']
      || ''
    const primarySrc = attrs.src || lazySrc || bestFromSrcset?.url || ''
    const figure = figureAt(figures, imgMatch.index)
    const width = Number(attrs.width || 0) || bestFromSrcset?.width || 0
    const height = Number(attrs.height || 0)
    const shared = {
      alt: attrs.alt || attrs.title || '',
      caption: figure?.caption || '',
      context: contextAt(html, imgMatch.index, imgMatch[0].length),
      className: attrs.class || '',
      inFigure: Boolean(figure),
      hasCaption: Boolean(figure?.caption),
    }
    push({ ...shared, url: primarySrc, width, height, responsive: Boolean(bestFromSrcset) })
    // 同一个 <img> 的其余写法都单独入列而不是二选一：src 是占位图、真图在 data-src 的
    // 站点很多，先到先得会把这条 <img> 唯一可用的地址挤掉。重复 URL 由 push 去重，
    // 哪一个写法能用交给下游规则判定。
    if (lazySrc && lazySrc !== primarySrc && candidates.length < maxCandidates) {
      push({ ...shared, url: lazySrc, width, height, responsive: Boolean(bestFromSrcset) })
    }
    if (bestFromSrcset && bestFromSrcset.url !== primarySrc && candidates.length < maxCandidates) {
      push({
        ...shared,
        url: bestFromSrcset.url,
        // width/height 属性描述的是 src 那个 rendition 的排版盒子；拿它去评判 1600w 的
        // 大图会把唯一一张合格插图压到 min_width 以下。
        width: bestFromSrcset.width || width,
        height: bestFromSrcset.width ? 0 : height,
        responsive: true,
      })
    }
    imgMatch = imgPattern.exec(html)
  }

  return candidates
}

/**
 * 从 Jina（r.jina.ai，Accept: text/markdown）返回的正文 markdown 里提取图片候选。
 * jinaRead 已经把这段文本拉回来了，之前只用正文、图片链接直接丢弃。
 */
export function extractMarkdownImageCandidates(markdown, baseUrl, {
  maxCandidates = MAX_CANDIDATES_PER_ITEM,
} = {}) {
  const text = String(markdown || '').slice(0, MAX_MARKUP_CHARS)
  if (!text.includes('![') && !text.includes('<img')) return []
  // 代码块里的 `![...](...)` 是被讨论的示例，不是这篇文章的配图。
  const body = text.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ')
  const candidates = []
  const seen = new Set()

  const push = (fields) => {
    const url = absoluteImageUrl(baseUrl, fields.url)
    if (!url || seen.has(url)) return
    if (isFeedTrackingUrl(url)) return
    if (!isPublicHttpUrl(url)) return
    seen.add(url)
    candidates.push(buildCandidate({
      ...fields,
      url,
      kind: 'article-markdown',
      field: 'jina_markdown',
      origin: 'markdown',
    }))
  }

  // `![alt](url "title")`，含被链接包裹的 `[![alt](url)](href)` 形式。
  const pattern = /!\[([^\]]*)\]\(\s*<?([^\s)<>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g
  let match = pattern.exec(body)
  while (match && candidates.length < maxCandidates) {
    // r.jina.ai 给每张图加 `Image 5: ` 前缀，那是它的编号不是描述，剥掉后剩下的才是 alt。
    const alt = String(match[1] || '').replace(/^\s*Image\s+\d+\s*:\s*/i, '')
    push({
      url: match[2],
      alt,
      caption: '',
      context: contextAt(body, match.index, match[0].length),
      width: 0,
      height: 0,
      className: '',
      inFigure: false,
      hasCaption: false,
      responsive: false,
    })
    match = pattern.exec(body)
  }

  // Jina 对部分站点会保留原始 <img>，走同一套属性解析。
  if (candidates.length < maxCandidates && body.includes('<img')) {
    for (const inline of extractImageCandidatesFromMarkup(body, baseUrl, {
      kind: 'article-markdown',
      field: 'jina_markdown',
      origin: 'markdown',
      maxCandidates: maxCandidates - candidates.length,
    })) {
      if (seen.has(inline.url)) continue
      seen.add(inline.url)
      candidates.push(inline)
    }
  }

  return candidates
}

function markupNodes(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return []
  if (typeof value === 'string' || typeof value === 'number') return [String(value)]
  if (Array.isArray(value)) return value.flatMap((entry) => markupNodes(entry, depth + 1))
  if (typeof value === 'object' && value['#text'] !== undefined) return markupNodes(value['#text'], depth + 1)
  return []
}

function toArray(value) {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

// Media RSS（<media:content> / <media:thumbnail>）和 <enclosure> 是结构化声明，不用解析
// HTML。它们通常指向这篇文章的主图，但没有版式信息，所以位置信号一律留空 —— 由下游决定
// 要不要用，不在这里伪造 inFigure/hasCaption 给自己加分。
function mediaNodeCandidates(entry, key, { field, kind }) {
  const results = []
  for (const node of toArray(entry?.[key])) {
    if (!node || typeof node !== 'object') continue
    const type = String(node['@_type'] || '').toLowerCase()
    const medium = String(node['@_medium'] || '').toLowerCase()
    const url = String(node['@_url'] || '')
    if (!url) continue
    // 只要图片：媒体 feed 里同一个位置也可能挂视频或音频。
    const looksImage = medium === 'image'
      || type.startsWith('image/')
      || (!type && !medium && IMAGE_EXTENSION_PATTERN.test(url))
    if (!looksImage) continue
    results.push({
      url,
      alt: markupNodes(node['media:title'] ?? node['media:description']).map(stripTags).join(' '),
      width: Number(node['@_width'] || 0) || 0,
      height: Number(node['@_height'] || 0) || 0,
      className: '',
      field,
      kind,
      inArticle: false,
      inMain: false,
      inFigure: false,
      hasCaption: false,
      responsive: false,
    })
  }
  return results
}

/**
 * 一条 RSS/Atom item（fast-xml-parser 的解析结果节点）→ 图片候选列表。
 *
 * 覆盖的字段，按可信度从高到低：
 *   content:encoded / content  —— 正文全文 HTML（WordPress 系标配）
 *   description / summary      —— 摘要，多数站点的首图就在这里
 *   media:group > media:content、media:content、media:thumbnail、enclosure
 *
 * 注意命名空间：解析器没有开 removeNSPrefix，键名就是带冒号的原样 `content:encoded`。
 */
export function extractFeedItemMediaCandidates(entry, {
  baseUrl = '',
  maxCandidates = MAX_CANDIDATES_PER_ITEM,
} = {}) {
  if (!entry || typeof entry !== 'object') return []

  const markupFields = [
    ['content:encoded', 'feed-content'],
    ['content', 'feed-content'],
    ['description', 'feed-summary'],
    ['summary', 'feed-summary'],
  ]

  const lists = []
  for (const [key, kind] of markupFields) {
    for (const markup of markupNodes(entry[key])) {
      if (!markup.includes('<img') && !markup.includes('<source')) continue
      lists.push(extractImageCandidatesFromMarkup(markup, baseUrl, { kind, field: key, maxCandidates }))
    }
  }

  const structured = [
    ...toArray(entry['media:group']).flatMap((group) => mediaNodeCandidates(group, 'media:content', {
      field: 'media:group', kind: 'feed-media',
    })),
    ...mediaNodeCandidates(entry, 'media:content', { field: 'media:content', kind: 'feed-media' }),
    ...mediaNodeCandidates(entry, 'media:thumbnail', { field: 'media:thumbnail', kind: 'feed-media' }),
    ...mediaNodeCandidates(entry, 'enclosure', { field: 'enclosure', kind: 'feed-enclosure' }),
  ]
  const structuredCandidates = []
  for (const fields of structured) {
    const url = absoluteImageUrl(baseUrl, fields.url)
    if (!url || isFeedTrackingUrl(url) || !isPublicHttpUrl(url)) continue
    if (isTrackingPixel(fields.width, fields.height)) continue
    structuredCandidates.push(buildCandidate({ ...fields, url, origin: 'feed' }))
  }
  lists.push(structuredCandidates)

  return mergeMediaCandidates(...lists).slice(0, maxCandidates)
}

// 同一张图会同时出现在 content:encoded、description 和 media:content 里，三处的信息量
// 不一样（正文里有 figcaption，media:content 里有精确宽高）。合并时保留信息更全的那条，
// 而不是先到先得地丢掉后面的 alt / caption / 尺寸。
export function mergeMediaCandidates(...lists) {
  const byUrl = new Map()
  for (const list of lists) {
    for (const candidate of Array.isArray(list) ? list : []) {
      if (!candidate?.url) continue
      const existing = byUrl.get(candidate.url)
      if (!existing) {
        byUrl.set(candidate.url, { ...candidate })
        continue
      }
      byUrl.set(candidate.url, {
        ...existing,
        alt: existing.alt || candidate.alt,
        caption: existing.caption || candidate.caption,
        context: existing.context || candidate.context,
        width: existing.width || candidate.width,
        height: existing.height || candidate.height,
        className: existing.className || candidate.className,
        inArticle: existing.inArticle || candidate.inArticle,
        inMain: existing.inMain || candidate.inMain,
        inFigure: existing.inFigure || candidate.inFigure,
        hasCaption: existing.hasCaption || candidate.hasCaption,
        responsive: existing.responsive || candidate.responsive,
      })
    }
  }
  return [...byUrl.values()]
}
