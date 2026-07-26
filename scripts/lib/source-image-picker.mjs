import { fetchPublicResource, readLimitedResponseBody } from './image-localizer.mjs'
import { isPublicHttpUrl } from './url-guard.mjs'

// Source pages are third-party HTML of unknown size; without a ceiling a single
// hostile or broken origin can exhaust the worker's memory via response.text().
const DEFAULT_MAX_HTML_BYTES = 2 * 1024 * 1024

// og:image / twitter:image answer the question "what should a share preview look
// like", which is routinely a site-wide or section-wide card. Ranking them first
// is what made a handful of images repeat across many published articles, so they
// are demoted to a fallback tier.
const SCORE_META_BASE = 0.05
const SCORE_INLINE_BASE = 0.12
const SCORE_IN_ARTICLE = 0.14
const SCORE_IN_FIGURE = 0.1
// A <figcaption> is almost proof of an editorial illustration: chrome, promos and
// share cards are never captioned.
const SCORE_HAS_CAPTION = 0.24
const SCORE_RESPONSIVE = 0.06
const SCORE_LARGE = 0.1
const SCORE_EXTRA_LARGE = 0.08
const SCORE_ALT = 0.04
const SCORE_PRIMARY_SOURCE = 0.03

// 来源归属：本章节实际引用了哪几条来源（正文里的 S1/S2 标记）。这是中文章节标题和
// 英文图片 URL 之间**唯一真正可靠的桥**——词面匹配在跨语言场景下命中率≈0，而"这一章
// 讲的是 S2 那条新闻"是编排阶段就已经存在的结构化事实。所以它是权重最高的一项。
const SCORE_SECTION_SOURCE = 0.5
// 章节声明了归属、而这张图来自别的来源页：不是硬过滤（归属源可能一张图都没有），
// 而是一个足以改变排序的减分，让跨来源取图只在别无选择时才发生。
const PENALTY_SECTION_SOURCE_MISS = 0.18

// 正文插图的典型版式是横向的 4:3～21:9；再扁就是站头/横幅，再瘦就是侧栏挂件。
const SCORE_ARTICLE_ASPECT = 0.08
const PENALTY_BANNER_ASPECT = 0.2
const ARTICLE_ASPECT_MIN = 1.05
const ARTICLE_ASPECT_MAX = 2.6
const BANNER_ASPECT_RATIO = 3.2
const PORTRAIT_ASPECT_RATIO = 0.6

// 词面匹配退居次要信号，并且封顶：命中数不设上限时，一个长英文标题能凭十几个 token
// 把分数推到任何结构性信号之上。
const SCORE_SECTION_TERM = 0.09
const SCORE_SECTION_TERM_IN_SOURCE = 0.05
const SCORE_TOPIC_TERM = 0.06
const SCORE_TOPIC_TERM_IN_SOURCE = 0.03
// 源材料标题是英文，图片 alt/URL 也是英文——同语言比对才是有效的那条线。
const SCORE_SOURCE_TITLE_TERM = 0.07
// 章节正文 vs 图片 caption/上下文：两侧都是自然语言（且中文源站两侧都是中文），
// 这是唯一一条能真正判断"这张图讲的是不是这一段"的通道。以重合率（0–1）计分而不是
// 命中数，因为同一来源下的两张带 caption 的图会瞬间打满命中上限、失去区分度。
// 权重低于结构性归属（0.5）：归属决定"用哪个来源的图"，caption 决定"用这个来源的哪一张"。
const SCORE_SECTION_CAPTION_MATCH = 0.3
// 上下文窗口横跨整篇短文，同一条 item 里几张图往往拿到几乎相同的窗口，
// 所以它只是"这篇讲的是不是这件事"的弱旁证，不能参与"这一张 vs 那一张"的裁决。
const SCORE_SECTION_CONTEXT_MATCH = 0.06
const MAX_TERM_HITS = 3

// 同一来源页已经给过本文一张图时的降权，只在确实存在多个可用来源时生效，
// 这样单来源文章不会因为"多样性"而丢覆盖率。
const PENALTY_SOURCE_REUSE = 0.12

const MIN_SELECTION_SCORE = 0.18
const MIN_PRIMARY_FALLBACK_SCORE = 0.08

// Matched as whole path segments (extension stripped on the last one) rather than
// as substrings: `/social-thumbnails/blog/...` must die while a legitimate
// `/thumbnails/1600x900/photo.jpg` content image must survive.
export const DEFAULT_SOCIAL_CARD_PATH_SEGMENTS = [
  '_si',
  'card',
  'cards',
  'default',
  'defaults',
  'fallback',
  'og',
  'og-image',
  'og_image',
  'ogimage',
  'open-graph',
  'opengraph',
  'placeholder',
  'placeholders',
  'share',
  'share-image',
  'shareimage',
  'social',
  'social-card',
  'social-cards',
  'social-media',
  'social-thumbnails',
  'socialcard',
  'twitter-card',
  'twittercard',
]

const IMAGE_EXTENSION_PATTERN = /\.(png|jpe?g|gif|webp|avif|svg)$/i

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

function matchTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Blocklist keywords are matched against token prefixes instead of raw
// substrings. `ads` used to drop every `/downloads/` path and `card` would drop
// `cardiology`; token matching keeps `advert`→`advertisement` working while
// leaving unrelated words alone. Multi-part keywords (`og-image`) must appear as
// consecutive tokens.
function matchesBlocklistKeyword(text, keywords) {
  const tokens = matchTokens(text)
  if (tokens.length === 0) return false
  return (keywords || []).some((keyword) => {
    const parts = matchTokens(keyword)
    if (parts.length === 0) return false
    return tokens.some((_, index) => (
      parts.every((part, offset) => String(tokens[index + offset] || '').startsWith(part))
    ))
  })
}

function urlPathSegments(url) {
  try {
    const pathname = new URL(url).pathname
    let decoded = pathname
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      decoded = pathname
    }
    return decoded.split('/').filter(Boolean)
  } catch {
    return []
  }
}

function hasSocialCardPathSegment(url, segments) {
  const blocked = new Set((segments || []).map((item) => String(item).toLowerCase()))
  if (blocked.size === 0) return false
  const parts = urlPathSegments(url)
  return parts.some((part, index) => {
    const bare = index === parts.length - 1 ? part.replace(IMAGE_EXTENSION_PATTERN, '') : part
    return blocked.has(bare.toLowerCase())
  })
}

// Card generators such as `https://s0.wp.com/_si/?t=<base64>` carry no keyword at
// all: the whole image identity lives in the query string behind a short, generic
// endpoint name. Real content CDNs either end in a file extension or keep a long
// identifier in the path (`/photo-1518791841217-8f162f1e1131`), so both stay allowed.
function looksLikeGeneratedCardEndpoint(url) {
  try {
    const parsed = new URL(url)
    if (!parsed.search || parsed.search.length < 16) return false
    const segments = urlPathSegments(url)
    if (segments.length > 2) return false
    const last = segments.at(-1) || ''
    if (IMAGE_EXTENSION_PATTERN.test(last)) return false
    if (last.length >= 16) return false
    return true
  } catch {
    return false
  }
}

const NAMED_HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

// Attribute values are HTML-escaped in the source, and WordPress/Jetpack in particular emit
// query separators as `&#038;` or `&amp;`. Left encoded, `…?w=1330&#038;ssl=1` parses as a
// parameter literally named `#038;ssl`, so two renditions of one photo produced two different
// de-duplication keys and both got published. One pass, so `&amp;#038;` is not double-decoded.
export function decodeHtmlEntities(value) {
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

function parseAttrs(attrText) {
  const attrs = {}
  // Values may be double-quoted, single-quoted, unquoted (<img src=https://…>)
  // or absent (boolean attributes). The previous quoted-only pattern silently
  // produced empty attribute maps for perfectly ordinary markup.
  const pattern = /([:@\w.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g
  let match = pattern.exec(attrText)
  while (match) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(value)
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

// Ranges of the enclosing semantic containers, tracked with a stack so nested
// <article> blocks (comment threads, "related posts") still close correctly.
function collectTagRanges(html, tagName) {
  const ranges = []
  const open = []
  const pattern = new RegExp(`<(/?)${tagName}(\\s[^>]*)?>`, 'gi')
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
  // Truncated markup (the body cap above cuts mid-document) leaves tags open;
  // treat them as running to the end rather than losing the placement signal.
  while (open.length > 0) ranges.push({ start: open.pop(), end: html.length })
  return ranges
}

function buildDocumentContext(html) {
  return {
    article: collectTagRanges(html, 'article'),
    main: collectTagRanges(html, 'main'),
    figure: collectTagRanges(html, 'figure').map((range) => {
      const markup = html.slice(range.start, range.end)
      return {
        ...range,
        hasCaption: /<figcaption[\s>]/i.test(markup),
        // The caption *text*, not just its presence. On a Chinese source site this is the only
        // Chinese sentence describing the picture, and it is what a Chinese section heading is
        // scored against; keeping only the boolean threw away the entire signal.
        caption: captionTextOf(markup),
      }
    }),
  }
}

function captionTextOf(figureMarkup) {
  const matched = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figureMarkup)
  if (!matched) return ''
  return truncateMatchText(decodeHtmlEntities(matched[1].replace(/<[^>]+>/g, ' ')))
}

function containsIndex(range, index) {
  return index >= range.start && index < range.end
}

function placementAt(context, index) {
  const figure = context.figure.find((range) => containsIndex(range, index))
  return {
    inArticle: context.article.some((range) => containsIndex(range, index)),
    inMain: context.main.some((range) => containsIndex(range, index)),
    inFigure: Boolean(figure),
    hasCaption: Boolean(figure?.hasCaption),
    caption: figure?.caption || '',
  }
}

// Plenty of real illustrations carry no width/height attribute and no srcset descriptor, but
// the CDN still states the rendition size in the URL (`?w=150`, `?resize=1330,564`,
// `-150x150.jpg`, `!72x72r`, `.width-100`). Without reading it, `min_width`/`min_height` were
// dead letters on exactly the images they exist to stop: a 128x128 podcast badge and a 72x72
// author avatar both got published as article illustrations.
export function inferDimensionsFromUrl(url) {
  let width = 0
  let height = 0
  const consider = (rawWidth, rawHeight) => {
    const nextWidth = Number(rawWidth) || 0
    const nextHeight = Number(rawHeight) || 0
    // Keep the smallest positive claim: `.../crop/72x72/` after `thumbnail/!72x72r` must not be
    // masked by a larger number elsewhere in the same URL.
    if (nextWidth > 0 && (width === 0 || nextWidth < width)) width = nextWidth
    if (nextHeight > 0 && (height === 0 || nextHeight < height)) height = nextHeight
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { width: 0, height: 0 }
  }
  for (const [key, value] of parsed.searchParams.entries()) {
    const name = key.toLowerCase()
    if (name === 'w' || name === 'width') consider(value, 0)
    else if (name === 'h' || name === 'height') consider(0, value)
    else if (name === 'resize' || name === 'fit' || name === 'size') {
      const pair = /^(\d{2,5})\s*[,x]\s*(\d{2,5})$/i.exec(String(value).trim())
      if (pair) consider(pair[1], pair[2])
    }
  }
  let path = parsed.pathname
  try {
    path = decodeURIComponent(path)
  } catch { /* keep the raw path */ }
  const scanned = `${path}${parsed.search ? decodeURIComponentSafe(parsed.search) : ''}`
  // The pair has to start at a token boundary (`-1024x576`, `/72x72/`, `!72x72r`, `_863x300`).
  // Anchoring on `[^\d]` alone would read a size out of an opaque asset id such as
  // `abc12x34def.jpg` and drop a perfectly good illustration.
  for (const match of scanned.matchAll(/(?:^|[^a-z0-9])(\d{2,5})\s*[x×]\s*(\d{2,5})(?![\d])/gi)) {
    consider(match[1], match[2])
  }
  for (const match of scanned.matchAll(/\.width-(\d{2,5})/gi)) consider(match[1], 0)
  for (const match of scanned.matchAll(/\.height-(\d{2,5})/gi)) consider(0, match[1])
  return { width, height }
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// The share-card / chrome / undersized rules that can be decided from the URL alone, with no
// surrounding markup. Split out so an audit of already-published image URLs grades them with
// exactly the rules a live run applies, rather than a re-implementation that can drift.
// Returns the rule name that rejected the URL, or '' when it is acceptable.
export function classifyRejectedImageUrl(url, rules = {}) {
  if (!url) return 'empty'
  const { width, height } = inferDimensionsFromUrl(url)
  if (width && width < (rules.min_width || 0)) return 'min_width'
  if (height && height < (rules.min_height || 0)) return 'min_height'
  if (matchesBlocklistKeyword(url, rules.blocklist_keywords || [])) return 'blocklist_keyword'
  const socialSegments = rules.social_card_path_segments ?? DEFAULT_SOCIAL_CARD_PATH_SEGMENTS
  if (hasSocialCardPathSegment(url, socialSegments)) return 'social_card_path_segment'
  if (rules.reject_generated_card_endpoints !== false && looksLikeGeneratedCardEndpoint(url)) return 'generated_card_endpoint'
  // Checked last only so the returned label names the interesting rule when several apply: a
  // URL whose path ends in `/` is a page, not an image. Published bodies contain a few of
  // these from the old empty-attribute bug, so the audit has to recognise them too.
  if (looksLikeDirectoryUrl(url)) return 'directory_url'
  return ''
}

function shouldDropCandidate(candidate, rules) {
  if (!candidate.url) return true
  let { width, height } = candidate
  // Only consulted when the markup said nothing at all, so an explicit attribute or an srcset
  // descriptor always wins over a number guessed out of the URL.
  if (!width && !height) ({ width, height } = inferDimensionsFromUrl(candidate.url))
  if (width && width < (rules.min_width || 0)) return true
  if (height && height < (rules.min_height || 0)) return true
  // Deliberately NOT including alt text. Blocklist entries name the image's *role*
  // ("logo", "banner", "icon"); alt text names its *subject*, and TechCrunch's real
  // 1024x521 captioned article photo is described as "Gemini icon" — matching alt threw
  // away the one genuine illustration on the page and left an author avatar behind.
  const haystack = `${candidate.url} ${candidate.className}`
  if (matchesBlocklistKeyword(haystack, rules.blocklist_keywords || [])) return true
  const socialSegments = rules.social_card_path_segments ?? DEFAULT_SOCIAL_CARD_PATH_SEGMENTS
  if (hasSocialCardPathSegment(candidate.url, socialSegments)) return true
  if (rules.reject_generated_card_endpoints !== false && looksLikeGeneratedCardEndpoint(candidate.url)) return true
  return false
}

export function extractImageCandidatesFromHtml(html, pageUrl) {
  const candidates = []
  const seen = new Set()
  const context = buildDocumentContext(html)
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
        inArticle: false,
        inMain: false,
        inFigure: false,
        hasCaption: false,
        responsive: false,
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
        responsive: true,
        ...placementAt(context, sourceMatch.index),
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
    const placement = placementAt(context, imgMatch.index)
    push({
      url: absoluteUrl(pageUrl, src),
      alt: attrs.alt || attrs.title || '',
      width: Number(attrs.width || 0) || bestFromSrcset?.width || 0,
      height: Number(attrs.height || 0),
      className: attrs.class || '',
      kind: 'inline-image',
      responsive: Boolean(bestFromSrcset),
      ...placement,
    })
    if (bestFromSrcset && (attrs.src || attrs['data-src'] || attrs['data-lazy-src'])) {
      push({
        url: absoluteUrl(pageUrl, bestFromSrcset.url),
        alt: attrs.alt || attrs.title || '',
        // width/height attributes describe the layout box of the *src* variant;
        // grading the 1600w asset with a 200px layout box dropped it below
        // min_width and threw away the only real illustration on the page.
        width: bestFromSrcset.width || Number(attrs.width || 0) || 0,
        height: bestFromSrcset.width ? 0 : Number(attrs.height || 0),
        className: attrs.class || '',
        kind: 'inline-image',
        responsive: true,
        ...placement,
      })
    }
    imgMatch = imgPattern.exec(html)
  }

  return candidates
}

// Jina returns the source article as markdown (`Accept: text/markdown`) and the pipeline
// already pays for that call, but until now it kept only the prose and threw the
// `![alt](url)` links away. RSS `content:encoded` is the same story in HTML form. Both are
// *article body* by construction, so anything found here is marked in-article: it cannot be
// site chrome, a sidebar promo or a share card, which is exactly the provenance the
// HTML scraper has to guess at.
// Intake for candidates a caller extracted itself (lib/feed-media.mjs builds these from
// `content:encoded` / `media:content` / the Jina markdown). Their provenance is already
// known, so they are taken at face value for placement — but they are *not* trusted past
// that: they still go through shouldDropCandidate and the SSRF guard like anything else.
export function normalizeExternalCandidate(candidate, baseUrl) {
  if (!candidate || typeof candidate !== 'object') return null
  const url = absoluteUrl(baseUrl, candidate.url || '')
  if (!url || looksLikeDirectoryUrl(url) || isSameDocument(url, baseUrl)) return null
  return {
    url,
    alt: String(candidate.alt || candidate.caption || '').trim(),
    // Carried through rather than folded into `alt`: these two are the only natural-language
    // *description* of the picture that exists anywhere in the pipeline, and on a Chinese
    // source site they are the only Chinese text a Chinese section heading can ever match.
    // Flattening them into `alt` would have leaked caption prose into the identity signals
    // (alt is also compared against the source title and the blocklist reads it).
    caption: truncateMatchText(candidate.caption),
    context: truncateMatchText(candidate.context),
    width: Number(candidate.width) || 0,
    height: Number(candidate.height) || 0,
    className: String(candidate.className || ''),
    // Anything that is not explicitly a share card counts as body content.
    kind: candidate.kind === 'meta-image' ? 'meta-image' : 'inline-image',
    inArticle: candidate.inArticle !== false,
    inMain: candidate.inMain !== false,
    inFigure: Boolean(candidate.inFigure),
    hasCaption: Boolean(candidate.hasCaption || candidate.caption),
    responsive: Boolean(candidate.responsive),
  }
}

// Third-party text, so it is bounded before it ever reaches the tokenizer.
function truncateMatchText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > 400 ? text.slice(0, 400) : text
}

export function extractImageCandidatesFromMarkdown(markdown, baseUrl) {
  const candidates = []
  const seen = new Set()
  const text = String(markdown || '')
  const push = (rawUrl, alt) => {
    const url = absoluteUrl(baseUrl, rawUrl)
    if (!url || seen.has(url)) return
    if (isSameDocument(url, baseUrl) || looksLikeDirectoryUrl(url)) return
    seen.add(url)
    candidates.push({
      url,
      alt: decodeHtmlEntities(String(alt || '').trim()),
      width: 0,
      height: 0,
      className: '',
      kind: 'inline-image',
      inArticle: true,
      inMain: true,
      inFigure: false,
      hasCaption: false,
      responsive: false,
    })
  }

  // ![alt](url "title") — the URL may be wrapped in <> and followed by an optional title.
  for (const match of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'(][^)]*)?\)/g)) {
    push(match[2], match[1])
  }
  // ![alt][ref] paired with a `[ref]: url` definition line.
  const references = new Map()
  for (const match of text.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?(\S+)>?/gm)) {
    references.set(match[1].trim().toLowerCase(), match[2])
  }
  for (const match of text.matchAll(/!\[([^\]]*)\]\[([^\]]*)\]/g)) {
    const key = (match[2].trim() || match[1].trim()).toLowerCase()
    if (references.has(key)) push(references.get(key), match[1])
  }
  // Feeds routinely ship raw <img> inside markdown/CDATA bodies.
  for (const candidate of extractImageCandidatesFromHtml(text, baseUrl)) {
    if (candidate.kind === 'meta-image') continue
    push(candidate.url, candidate.alt)
  }

  return candidates
}

const CJK_PATTERN = /[\u4e00-\u9fff]/
// Latin tokens shorter than 3 characters and pure numbers are dropped: they exist in
// every CDN path (`ai`, `w`, `07`, `2026`) and used to hand out relevance points by
// accident \u2014 the only "match" the old code ever scored on a Chinese heading was the
// literal token `ai` landing inside an unrelated filename.
const TERM_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have',
  'its', 'their', 'they', 'them', 'you', 'your', 'our', 'his', 'her', 'not', 'but', 'all',
  'can', 'will', 'would', 'could', 'should', 'may', 'might', 'more', 'most', 'than', 'then',
  'how', 'why', 'what', 'when', 'where', 'which', 'who', 'whom', 'about', 'into', 'over',
  'after', 'before', 'also', 'just', 'like', 'some', 'such', 'said', 'says', 'new', 'now',
  'out', 'off', 'per', 'via', 'use', 'used', 'using', 'get', 'got', 'make', 'made', 'one',
  'two', 'three', 'here', 'there', 'been', 'being', 'does', 'did', 'doing', 'own', 'very',
  // \u56fe\u5e8a/\u7ad9\u70b9\u7ed3\u6784\u8bcd\uff1a\u51fa\u73b0\u5728\u51e0\u4e4e\u6bcf\u4e2a\u56fe\u7247 URL \u91cc\uff0c\u547d\u4e2d\u5b83\u4eec\u6ca1\u6709\u4efb\u4f55\u76f8\u5173\u6027\u542b\u4e49
  'www', 'com', 'net', 'org', 'http', 'https', 'cdn', 'img', 'image', 'images', 'photo',
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'static', 'assets', 'media', 'file',
  'files', 'uploads', 'upload', 'content', 'blog', 'news', 'post', 'posts', 'article',
  'articles', 'index', 'main', 'default', 'wp',
])

// \u65e7\u5b9e\u73b0\u7528 /[^\w\u4e00-\u9fff]+/ \u5207\u8bcd\uff0c\u628a\u6574\u4e32\u8fde\u7eed\u6c49\u5b57\u5e76\u6210**\u4e00\u4e2a** token\uff1a
// "\u6750\u6599\u74f6\u9888\u6b63\u5728\u6210\u4e3a\u4e0b\u4e00\u4ee3AI\u7684\u786c\u7ea6\u675f" \u2192 ["\u6750\u6599\u74f6\u9888\u6b63\u5728\u6210\u4e3a\u4e0b\u4e00\u4ee3ai\u7684\u786c\u7ea6\u675f"]\u3002
// \u62ff\u8fd9\u79cd 17 \u5b57\u7684 token \u53bb\u4efb\u4f55\u5730\u65b9 includes()\uff0c\u547d\u4e2d\u7387\u6052\u4e3a\u96f6\uff0c\u7ae0\u8282\u76f8\u5173\u6027\u90a3\u90e8\u5206\u5206\u6570
// \u56e0\u6b64\u4ece\u6765\u6ca1\u6709\u771f\u6b63\u751f\u6548\u8fc7\u3002\u4e2d\u6587\u6539\u6210\u4e8c\u5143\u5207\u5206\uff0c\u82f1\u6587\u4ecd\u6309\u8bcd\u5207\u5206\u3002
export function tokenizeForMatching(value) {
  const tokens = []
  for (const chunk of String(value || '').toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || []) {
    if (!CJK_PATTERN.test(chunk)) {
      if (chunk.length < 3) continue
      if (/^\d+$/.test(chunk)) continue
      if (TERM_STOP_WORDS.has(chunk)) continue
      tokens.push(chunk)
      continue
    }
    if (chunk.length === 1) continue
    for (let index = 0; index + 1 < chunk.length; index += 1) tokens.push(chunk.slice(index, index + 2))
  }
  return tokens
}

function buildMatchTarget(value) {
  const text = String(value || '').toLowerCase()
  return { text, tokens: new Set(matchTokens(text)) }
}

function candidateMatchTarget(candidate) {
  // The URL is percent-decoded first so a Chinese filename (`.../\u6a21\u578b\u67b6\u6784.png`) can be
  // matched at all, and so `%20` separated words become separate tokens.
  return buildMatchTarget(`${candidate.alt} ${decodeURIComponentSafe(candidate.url)} ${candidate.className}`)
}

// Separate from `candidateMatchTarget` on purpose: alt/URL/class is *identity* text and is
// compared against the heading and the source title, whereas figcaption + surrounding
// paragraph is *descriptive* text and is what the section's own prose gets compared to.
// Folding them into one target would let a long caption inflate the identity signals.
// Caption and surrounding-paragraph text are scored separately and very differently.
// A <figcaption> is written about one picture. The context window is ±700 characters of
// body text, which on a normal-length article covers *every* figure in it — measured on
// the feed fixtures, all four images of one item produced an identical context match, so
// folding the two together let the diffuse signal outvote the precise one and the ranking
// fell back to document order.
function candidateDescriptionTargets(candidate) {
  const caption = `${candidate.caption || ''} ${candidate.alt || ''}`.trim()
  const context = String(candidate.context || '').trim()
  return {
    caption: caption ? withTermCount(buildMatchTarget(caption), caption) : null,
    context: context ? withTermCount(buildMatchTarget(context), context) : null,
  }
}

function withTermCount(target, text) {
  // Denominator for the overlap ratio below. Counted once here rather than per section.
  target.termCount = new Set(tokenizeForMatching(text)).size
  return target
}

// The identity signals above are *capped* counts, because an unbounded sum let a long
// English title outrank every structural signal. That cap is wrong for this channel: two
// captioned figures from the same source both saturate three hits instantly, so the one
// signal that could tell them apart went binary and the ranking fell back to pixel size.
// A ratio keeps the contribution bounded without throwing away the discrimination.
function termOverlapRatio(terms, target) {
  if (!target || !terms || terms.length === 0) return 0
  const unique = new Set(terms)
  if (unique.size === 0 || !target.termCount) return 0
  let hits = 0
  for (const term of unique) {
    if (CJK_PATTERN.test(term) ? target.text.includes(term) : target.tokens.has(term)) hits += 1
  }
  if (hits === 0) return 0
  // Short captions must not be punished for being short: the denominator is whichever side
  // has fewer terms, so "this caption is entirely about this section" scores 1.0.
  return Math.min(1, hits / Math.min(unique.size, target.termCount))
}

// Latin terms must match a whole token, not a substring: `includes('ads')` matching
// `/downloads/` is the same class of bug the blocklist already had to fix. CJK bigrams
// stay substring matches because the target text has no word boundaries either.
function countTermHits(terms, target) {
  let hits = 0
  const counted = new Set()
  for (const term of terms) {
    if (!term || counted.has(term)) continue
    counted.add(term)
    if (CJK_PATTERN.test(term)) {
      if (target.text.includes(term)) hits += 1
    } else if (target.tokens.has(term)) {
      hits += 1
    }
    if (hits >= MAX_TERM_HITS) return hits
  }
  return hits
}

// Attributes win when present, otherwise fall back to what the CDN states in the URL.
// Same precedence `shouldDropCandidate` already applies, so ranking and filtering agree
// about how big a picture is.
function resolveCandidateDimensions(candidate) {
  let width = Number(candidate.width) || 0
  let height = Number(candidate.height) || 0
  if (!width || !height) {
    const inferred = inferDimensionsFromUrl(candidate.url)
    width = width || inferred.width
    height = height || inferred.height
  }
  return { width, height }
}

function aspectRatioScore(width, height) {
  if (!width || !height) return 0
  const ratio = width / height
  if (ratio >= BANNER_ASPECT_RATIO || ratio <= PORTRAIT_ASPECT_RATIO) return -PENALTY_BANNER_ASPECT
  if (ratio >= ARTICLE_ASPECT_MIN && ratio <= ARTICLE_ASPECT_MAX) return SCORE_ARTICLE_ASPECT
  return 0
}

function candidateLooksHero(candidate) {
  // Deliberately no longer true for meta-image: a share card is not a hero shot,
  // and treating it as one is exactly how one card ended up in five articles.
  if (candidate.kind === 'meta-image') return false
  const { width, height } = resolveCandidateDimensions(candidate)
  return candidate.hasCaption
    || candidate.inFigure
    || candidate.className.includes('hero')
    || candidate.className.includes('featured')
    || width >= 960
    || height >= 540
}

// `S1` / `S2` \u2026 are the source IDs the outline and the article body both use. They arrive
// from the LLM inside free text as often as inside arrays ("\u4ee5 S2 \u4e3a\u4e3b\uff0c\u8f85\u4ee5 S5"), so they
// are pulled out by pattern rather than trusted to be a clean list.
const SOURCE_ID_PATTERN = /\bs\d{1,3}\b/g

function collectSourceRefs(value, ids, hints, depth = 0) {
  if (value == null || depth > 3) return
  if (Array.isArray(value)) {
    for (const entry of value) collectSourceRefs(entry, ids, hints, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) collectSourceRefs(entry, ids, hints, depth + 1)
    return
  }
  const text = String(value).trim().toLowerCase()
  if (!text) return
  // A URL is never an ID, and `\bs\d\b` happily fires on paths like `/s3-bucket/`.
  const looksLikeUrl = text.startsWith('http') || text.includes('://')
  if (!looksLikeUrl) {
    const matched = text.match(SOURCE_ID_PATTERN)
    if (matched) {
      for (const id of matched) ids.add(id)
      return
    }
  }
  // Not an ID: keep it as a hint so a caller that only knows URLs or outlet names
  // (`key_sources` frequently is exactly that) still gets attribution. Long prose is
  // dropped rather than stored — it can never be a substring of a source's identity.
  if (text.length >= 4 && text.length <= 200) hints.add(text)
}

// Headings arrive with `## ` markers, numbering and full-width punctuation that differ
// between the outline, the generated body and the attribution map. Matching on a stripped
// form keeps a side-channel attribution table usable even when the key is not byte-identical.
function attributionKey(value) {
  return String(value || '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/[\s　]+/g, '')
    .replace(/[：:，,。.、·—\-_（）()【】\[\]"'"'']/g, '')
    .toLowerCase()
}

// `sectionAttribution` is the orchestrator's side-channel form of the same data:
// `{ '## 章节': { heading, source_ids, source_urls, text, origin } }`. It is merged in here
// rather than required to be inlined into `sections`, because auto-blog computes the
// attribution *after* it has already fixed the heading list.
function indexAttribution(sectionAttribution) {
  const index = new Map()
  if (!sectionAttribution || typeof sectionAttribution !== 'object') return index
  const entries = Array.isArray(sectionAttribution)
    ? sectionAttribution.map((entry) => [entry?.heading, entry])
    : Object.entries(sectionAttribution)
  for (const [key, entry] of entries) {
    if (!entry || typeof entry !== 'object') continue
    for (const candidateKey of [key, entry.heading]) {
      const normalized = attributionKey(candidateKey)
      if (normalized && !index.has(normalized)) index.set(normalized, entry)
    }
  }
  return index
}

// Accepts the historical `sections: string[]` as well as the attributed form
// `{ heading, source_ids }`, so the orchestrator can adopt attribution incrementally.
// `sectionAttribution` supplies the same information out-of-band for plain string sections.
export function normalizeSectionTargets(sections, sectionAttribution) {
  const attributionIndex = indexAttribution(sectionAttribution)
  const targets = []
  const applyAttribution = (target) => {
    const entry = attributionIndex.get(attributionKey(target.heading))
    if (!entry) return target
    collectSourceRefs(
      [entry.source_ids, entry.must_use_sources, entry.source_focus, entry.source_urls, entry.sources],
      target.sourceIds,
      target.sourceHints,
    )
    // The section's own prose. It is the only Chinese natural-language description of what
    // the section is about, and therefore the only thing that can match a Chinese figcaption.
    if (!target.text) target.text = String(entry.text || '').trim()
    return target
  }
  for (const entry of Array.isArray(sections) ? sections : []) {
    if (typeof entry === 'string') {
      if (entry.trim()) {
        targets.push(applyAttribution({ heading: entry, sourceIds: new Set(), sourceHints: new Set(), text: '' }))
      }
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const heading = String(entry.heading || entry.section_heading || entry.title || '').trim()
    if (!heading) continue
    const sourceIds = new Set()
    const sourceHints = new Set()
    collectSourceRefs(
      [entry.source_ids, entry.must_use_sources, entry.source_focus, entry.sources, entry.evidence_cards],
      sourceIds,
      sourceHints,
    )
    targets.push(applyAttribution({
      heading,
      sourceIds,
      sourceHints,
      text: String(entry.text || entry.section_text || '').trim(),
    }))
  }
  return targets
}

function sectionMatchesSource(target, sourceItem = {}) {
  if (target.sourceIds.size === 0 && target.sourceHints.size === 0) return false
  const id = String(sourceItem.source_id || '').trim().toLowerCase()
  if (id && target.sourceIds.has(id)) return true
  if (target.sourceHints.size === 0) return false
  const identity = [sourceItem.url, sourceItem.title, sourceItem.source_name, sourceItem.domain]
    .map((part) => String(part || '').toLowerCase())
    .join(' ')
  if (!identity.trim()) return false
  return [...target.sourceHints].some((hint) => identity.includes(hint))
}

// Everything that depends only on the section, only on the source, or only on the candidate
// is computed once by the caller and handed in: otherwise the same source summary gets
// tokenized once per candidate per section.
function scoreCandidate(candidate, {
  candidateTarget,
  candidateDescription,
  sectionTerms,
  sectionTextTerms,
  topicTerms,
  sourceTarget,
  sourceTitleTerms,
  sourceItem = {},
  attributedSection = false,
  attributedMatch = false,
  sourceAlreadyUsed = false,
  spreadSources = false,
}) {
  const { width, height } = resolveCandidateDimensions(candidate)

  let score = 0
  if (candidate.kind === 'meta-image') {
    score += SCORE_META_BASE
  } else {
    score += SCORE_INLINE_BASE
    if (candidate.inArticle || candidate.inMain) score += SCORE_IN_ARTICLE
    if (candidate.inFigure) score += SCORE_IN_FIGURE
    if (candidate.hasCaption) score += SCORE_HAS_CAPTION
    if (candidate.responsive) score += SCORE_RESPONSIVE
  }
  if (width >= 600 || height >= 300) score += SCORE_LARGE
  if (width >= 960 || height >= 540) score += SCORE_EXTRA_LARGE
  score += aspectRatioScore(width, height)
  if (candidate.alt) score += SCORE_ALT
  if (sourceItem.is_primary) score += SCORE_PRIMARY_SOURCE

  // \u7ed3\u6784\u6027\u5f52\u5c5e\uff1a\u672c\u7ae0\u8282\u5f15\u7528\u4e86\u8fd9\u6761\u6765\u6e90 \u2192 \u5b83\u9875\u9762\u4e0a\u7684\u56fe\u5c31\u662f"\u5207\u9898"\u7684\u56fe\u3002
  if (attributedSection) {
    score += attributedMatch ? SCORE_SECTION_SOURCE : -PENALTY_SECTION_SOURCE_MISS
  }

  // \u7ae0\u8282\u6807\u9898\u547d\u4e2d\u56fe\u7247\u672c\u8eab\uff08\u4e2d\u6587\u6e90\u7ad9\u624d\u53ef\u80fd\u53d1\u751f\uff09\uff1b\u547d\u4e2d\u6e90\u6750\u6599\u6587\u672c\u662f\u66f4\u5f31\u7684\u65c1\u8bc1\u3002
  const sectionHitsCandidate = countTermHits(sectionTerms, candidateTarget)
  score += sectionHitsCandidate * SCORE_SECTION_TERM
  if (sectionHitsCandidate === 0) {
    score += countTermHits(sectionTerms, sourceTarget) * SCORE_SECTION_TERM_IN_SOURCE
  }

  const topicHitsCandidate = countTermHits(topicTerms, candidateTarget)
  score += topicHitsCandidate * SCORE_TOPIC_TERM
  if (topicHitsCandidate === 0) {
    score += countTermHits(topicTerms, sourceTarget) * SCORE_TOPIC_TERM_IN_SOURCE
  }

  // \u82f1\u6587\u5bf9\u82f1\u6587\uff1a\u6e90\u6750\u6599\u6807\u9898 vs \u56fe\u7247 alt/URL\uff0c\u662f\u552f\u4e00\u540c\u8bed\u8a00\u3001\u56e0\u6b64\u771f\u6b63\u53ef\u7528\u7684\u8bcd\u9762\u901a\u9053\u3002
  score += countTermHits(sourceTitleTerms, candidateTarget) * SCORE_SOURCE_TITLE_TERM

  // \u7ae0\u8282\u6b63\u6587 vs \u56fe\u7247\u8bf4\u660e\u6587\u5b57\uff08figcaption / \u5468\u8fb9\u6bb5\u843d\uff09\u3002\u4e24\u8fb9\u90fd\u662f\u81ea\u7136\u8bed\u8a00\uff0c\u4e2d\u6587\u6e90\u7ad9\u4e24\u8fb9
  // \u90fd\u662f\u4e2d\u6587\u2014\u2014\u8fd9\u662f\u300c\u8fd9\u5f20\u56fe\u662f\u4e0d\u662f\u5728\u8bb2\u8fd9\u4e00\u6bb5\u300d\u7684\u552f\u4e00\u76f4\u63a5\u8bc1\u636e\u3002
  if (candidateDescription && sectionTextTerms && sectionTextTerms.length > 0) {
    score += termOverlapRatio(sectionTextTerms, candidateDescription.caption) * SCORE_SECTION_CAPTION_MATCH
    score += termOverlapRatio(sectionTextTerms, candidateDescription.context) * SCORE_SECTION_CONTEXT_MATCH
  }

  if (spreadSources && sourceAlreadyUsed) score -= PENALTY_SOURCE_REUSE

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
  // Either `['## 章节标题', …]` (historical) or the attributed form
  // `[{ heading, source_ids }, …]`. The attributed form is what makes a picture actually
  // match the section it sits under; see normalizeSectionTargets.
  sections,
  // Out-of-band form of the same attribution, keyed by the heading strings in `sections`:
  //   { '## 章节': { heading, source_ids: ['S2'], source_urls: [...], text, origin } }
  // auto-blog computes this *after* the heading list is fixed, so it cannot inline it into
  // `sections`. Both forms are merged; either alone is enough.
  sectionAttribution,
  topic,
  // Each item may additionally carry `media_candidates` (what lib/feed-media.mjs attaches to
  // every feed item, also fed from the Jina markdown), `content_html` (RSS content:encoded)
  // and/or
  // `content_markdown` (the Jina full-text response). Both are article body, so their
  // images are better provenance than anything scraped off the live page — and they are
  // the only images available at all for the many source sites that render their body
  // client-side (Hugging Face, sspai, most vendor blogs).
  sourceItems,
  config,
  fetchImpl,
  pinAddresses,
  lookupImpl,
  logger = console,
  maxHtmlBytes = DEFAULT_MAX_HTML_BYTES,
  // URLs already published by other articles. The picker has no store of its own,
  // so cross-article de-duplication is the caller's data and these are the hooks.
  // `excludeUrls` compares raw URLs; `isImageUrlExcluded` lets the caller compare on
  // its own normalised key (rendition suffixes folded away), which a raw Set cannot do.
  excludeUrls = [],
  isImageUrlExcluded,
  // Folds rendition variants of one picture onto a single key. Real pages serve the same
  // photo as `…Screenshot.jpg?w=1024` and `…Screenshot.jpg`, and a raw-URL set happily gave
  // two sections of one article the identical image. The caller owns this function because
  // it also owns the cross-article memory the keys have to agree with.
  normalizeUrlForDedupe,
}) {
  const rules = config.image_selection_rules || {}
  const maxImages = Math.max(0, rules.max_images || 0)
  const sectionTargets = normalizeSectionTargets(sections, sectionAttribution).slice(0, maxImages)
  if (sectionTargets.length === 0 || maxImages === 0) {
    return []
  }
  // 覆盖率下限：在还没凑够这么多张之前，允许退到"主图兜底 / og:image 兜底"这两档。
  // 凑够之后剩下的名额必须由真正的正文图凭分数拿到。
  const minImagesTarget = Math.max(1, Number(rules.min_images_target ?? 1) || 1)
  const topicTerms = tokenizeForMatching(topic)

  const dedupeKey = (url) => {
    if (typeof normalizeUrlForDedupe !== 'function') return String(url)
    try {
      return String(normalizeUrlForDedupe(url) || url)
    } catch {
      return String(url)
    }
  }

  const plans = []
  const usedUrls = new Set((excludeUrls || []).map((item) => dedupeKey(item)))
  const isExcluded = (url) => {
    if (usedUrls.has(dedupeKey(url))) return true
    if (typeof isImageUrlExcluded !== 'function') return false
    try {
      return Boolean(isImageUrlExcluded(url))
    } catch {
      // A broken predicate must not cost the article its illustrations; the caller's
      // own post-filter is the authoritative layer either way.
      return false
    }
  }

  // URL folding cannot catch every duplicate: blog.google serves one hero image as both
  // `…Gemini_Generated_Image_k2dxu1k2dx.width-200…` and `…k2dxu1k2d.width-2200…` — the
  // *filename itself* is truncated to a different length per rendition, so no suffix rule
  // can reunite them, and one picture quietly filled two sections of the same article.
  // Identical non-empty alt text on the same page is the same picture by any editorial
  // standard, so it is folded as well. Scoped to one page: unrelated sites reuse alt text.
  const altDedupeKey = (sourcePageUrl, alt) => {
    const text = String(alt || '').trim().toLowerCase()
    return text ? `alt\n${sourcePageUrl}\n${text}` : ''
  }
  const candidatesBySource = []
  const skippedSources = []
  let filteredCandidateCount = 0

  for (const item of sourceItems || []) {
    const extracted = []
    const addExtracted = (list) => {
      for (const candidate of list) {
        if (extracted.some((existing) => existing.url === candidate.url)) continue
        extracted.push(candidate)
      }
    }
    // Feed/full-text bodies first: they need no network call, they cannot fail, and their
    // images are article body by construction. A page fetch failure below therefore no
    // longer costs the article its illustrations when the body was already in hand.
    // `media_candidates` is what lib/feed-media.mjs attaches to every feed item and what
    // auto-blog forwards on researchPack.sources; `image_candidates` is the same shape under
    // the name the picker was originally written against. Both are accepted: a rename on
    // either side of this seam is exactly how the previous round's fix reached production
    // doing nothing at all.
    for (const list of [item?.media_candidates, item?.image_candidates]) {
      if (!Array.isArray(list)) continue
      addExtracted(list
        .map((candidate) => normalizeExternalCandidate(candidate, item.url))
        .filter(Boolean))
    }
    if (item?.content_html) addExtracted(extractImageCandidatesFromMarkdown(String(item.content_html), item.url))
    if (item?.content_markdown) addExtracted(extractImageCandidatesFromMarkdown(String(item.content_markdown), item.url))
    let pageRead = false
    try {
      const html = await fetchPageHtml(item.url, { fetchImpl, pinAddresses, lookupImpl, logger, maxHtmlBytes })
      addExtracted(extractImageCandidatesFromHtml(html, item.url))
      pageRead = true
    } catch (error) {
      // Silently swallowing this made "the source site is down" and "the URL was
      // blocked by the SSRF guard" indistinguishable in CI logs.
      const reason = error?.message || 'source page fetch failed'
      skippedSources.push({ url: item?.url || '', reason })
      logger?.warn?.(`Image picking skipped source page (${item?.url || 'unknown'}): ${reason}`)
    }
    // An unreadable page with no feed body contributes nothing at all; anything else still
    // counts as "we looked at this source", which is what the diagnostics below report on.
    if (!pageRead && extracted.length === 0) continue
    const candidates = extracted
      .filter((candidate) => !shouldDropCandidate(candidate, rules))
      // The chosen image_url is fetched again later (download/upload), so a candidate
      // pointing at a private/internal host is the same SSRF vector as the page itself.
      .filter((candidate) => isPublicHttpUrl(candidate.url))
    filteredCandidateCount += extracted.length - candidates.length
    candidatesBySource.push({
      item,
      candidates,
      // Per-source and per-candidate match material, computed once rather than once per
      // (candidate x section) pair inside the scorer.
      sourceTarget: buildMatchTarget(`${item.title || ''} ${item.source_name || ''} ${item.summary || ''}`),
      sourceTitleTerms: tokenizeForMatching(`${item.title || ''} ${item.source_name || ''}`),
      candidateTargets: new Map(candidates.map((candidate) => [candidate, candidateMatchTarget(candidate)])),
      candidateDescriptions: new Map(candidates.map((candidate) => [candidate, candidateDescriptionTargets(candidate)])),
    })
  }

  if (skippedSources.length > 0) {
    logger?.warn?.(`Image picking could not read ${skippedSources.length}/${(sourceItems || []).length} source page(s).`)
  }

  const contentCandidateCount = candidatesBySource
    .reduce((total, source) => total + source.candidates.filter((item) => item.kind !== 'meta-image').length, 0)
  const metaCandidateCount = candidatesBySource
    .reduce((total, source) => total + source.candidates.filter((item) => item.kind === 'meta-image').length, 0)
  if (contentCandidateCount === 0 && candidatesBySource.length > 0) {
    logger?.warn?.(`Image picking found no in-article image (${metaCandidateCount} share-card style candidate(s) kept, ${filteredCandidateCount} filtered out); falling back to the article's own share image if the rules allow one.`)
  }

  // The share-card defences (blocklist keywords, whole-segment path matching, generated
  // card endpoints) are URL-shape rules and apply to og:image exactly as they do to a body
  // image, so what `allow_meta_image_fallback` actually decides is "may an article use its
  // own cover picture when its body renders client-side". With cross-article de-duplication
  // in place a given cover can be published at most once, which is what made the blanket
  // "no" affordable to drop. It is still gated per source: a page that *does* expose body
  // images never gets to reach for its share card.
  const metaFallbackAllowed = rules.allow_meta_image_fallback === true
  const sourcesWithContent = candidatesBySource
    .filter((source) => source.candidates.some((candidate) => candidate.kind !== 'meta-image'))
  const spreadSources = sourcesWithContent.length > 1
  const usedSourcePages = new Set()

  for (const target of sectionTargets) {
    let bestPlan = null
    let primaryFallbackPlan = null
    let metaFallbackPlan = null
    const sectionTerms = tokenizeForMatching(target.heading)
    // Heading terms are included so a section with no prose still matches on its title.
    const sectionTextTerms = target.text ? tokenizeForMatching(`${target.heading} ${target.text}`) : sectionTerms
    const attributedSection = target.sourceIds.size > 0 || target.sourceHints.size > 0
    for (const source of candidatesBySource) {
      const sourceHasContent = source.candidates.some((candidate) => candidate.kind !== 'meta-image')
      const sourceAlreadyUsed = usedSourcePages.has(source.item.url)
      const attributedMatch = attributedSection && sectionMatchesSource(target, source.item)
      for (const candidate of source.candidates) {
        if (isExcluded(candidate.url)) continue
        const altKey = altDedupeKey(source.item.url, candidate.alt)
        if (altKey && usedUrls.has(altKey)) continue
        const score = scoreCandidate(candidate, {
          candidateTarget: source.candidateTargets.get(candidate),
          candidateDescription: source.candidateDescriptions.get(candidate),
          sectionTerms,
          sectionTextTerms,
          topicTerms,
          sourceTarget: source.sourceTarget,
          sourceTitleTerms: source.sourceTitleTerms,
          sourceItem: source.item,
          attributedSection,
          attributedMatch,
          sourceAlreadyUsed,
          spreadSources,
        })
        const plan = {
          section_heading: target.heading,
          image_url: candidate.url,
          source_page_url: source.item.url,
          source_name: source.item.source_name,
          source_id: source.item.source_id || '',
          reason: attributedMatch ? `section_source:${source.item.source_id || source.item.source_name || ''}` : `matched:${target.heading}`,
          alt_text: candidate.alt || source.item.title,
          score,
        }
        if (candidate.kind === 'meta-image') {
          if (metaFallbackAllowed && !sourceHasContent && (!metaFallbackPlan || score > metaFallbackPlan.plan.score)) {
            metaFallbackPlan = { plan: { ...plan, reason: `meta_image_fallback:${target.heading}` }, altKey }
          }
          continue
        }
        if (!bestPlan || score > bestPlan.plan.score) {
          bestPlan = { plan, altKey }
        }
        if (
          source.item?.is_primary
          && candidateLooksHero(candidate)
          && (!primaryFallbackPlan || score > primaryFallbackPlan.plan.score)
        ) {
          primaryFallbackPlan = {
            plan: { ...plan, reason: `primary_hero_fallback:${target.heading}` },
            altKey,
          }
        }
      }
    }

    let selected = null
    if (bestPlan && bestPlan.plan.score > MIN_SELECTION_SCORE) {
      selected = bestPlan
    } else if (plans.length < minImagesTarget && primaryFallbackPlan && primaryFallbackPlan.plan.score >= MIN_PRIMARY_FALLBACK_SCORE) {
      selected = primaryFallbackPlan
    } else if (plans.length < minImagesTarget && metaFallbackPlan) {
      selected = metaFallbackPlan
    }

    if (selected) {
      usedUrls.add(dedupeKey(selected.plan.image_url))
      if (selected.altKey) usedUrls.add(selected.altKey)
      usedSourcePages.add(selected.plan.source_page_url)
      plans.push(selected.plan)
    }
  }

  return plans
}
