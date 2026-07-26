import { XMLParser } from 'fast-xml-parser'

import { decodeFeedEntities, extractFeedItemMediaCandidates } from './feed-media.mjs'
import { countTokenOverlap, diceCoefficient, tokenizeTopicText } from './topic-tokens.mjs'

// fast-xml-parser 4.5.x 的实体展开计数器 `entityExpansionCount` 是**整篇文档累计**、
// 从不按字段重置的，而 boolean 形态的 processEntities 默认把 maxTotalExpansions 设成
// 1000 —— 一个转义 HTML 全文源，光正文里的 `&lt;` / `&gt;` / `&quot;` 就轻松过千
// （`&amp;` 走 ampEntity 单独一趟替换，不计入这个计数器），于是整篇 throw。
// 实测四个源全军覆没：AWS ML、GitHub Trending、MIT News、Simon Willison，
// 报 `Entity expansion limit exceeded: 1015~1111 > 1000`，共 118 条素材凭空消失；
// 而 fetchAllFeeds 只做 `.filter(status === 'fulfilled')`，一条日志都不打，所以没人发现。
//
// 标准实体替换后文本只会变短，不可能是放大攻击；真正的实体炸弹走 DOCTYPE 路径，由下面
// maxExpandedLength / maxExpansionDepth / maxEntitySize / maxEntityCount 四道独立防线
// 拦截，它们一律保持 boolean 模式的默认值（已实测 billion-laughs、超大单实体、实体数量
// 三种 payload 仍被拦下）。上限取 100 万只是对齐 MAX_FEED_BYTES=4MB 的结构性上界
// （最短实体 `&lt;` 4 字节），不是关闭防护 —— 不要改成 Infinity 或删掉整个对象。
const MAX_ENTITY_EXPANSIONS = 1_000_000

// removeNSPrefix 保持关闭：`content:encoded` / `media:content` 的键名就得是带冒号的原样，
// feed-media 按这个约定读取。改这里等于悄悄掐断 feed 正文图源。
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: {
    enabled: true,
    maxTotalExpansions: MAX_ENTITY_EXPANSIONS,
    // 以下四项是 DOCTYPE 实体炸弹的真正防线，保持 boolean 模式的默认值。
    // 注意：一旦传对象形态，fast-xml-parser 的隐含默认就会变（maxTotalExpansions→Infinity、
    // maxExpansionDepth→10000），所以必须逐项写死，不能靠省略继承。
    maxExpandedLength: 100000,
    maxExpansionDepth: 10,
    maxEntitySize: 10000,
    maxEntityCount: 1000,
  },
})

const DEFAULT_BUCKET_ORDER = [
  'official_vendor',
  'global_media',
  'research_media',
  'independent',
  'cn_ai_media',
  'community',
]
// Exported so tests assert against the value runBlogwatcher actually filters on instead of
// re-typing 0.8: what matters about a bad match is not that it scores zero, it is that it
// stays under the bar that decides whether it becomes a cited source.
export const DAILY_TOPIC_MATCH_THRESHOLD = 0.8

// 一个共同的通用词是巧合，不是同题。要求标题至少共享两个 token 才可能过阈值。
// 逐字复原当天的误匹配：GitHub Trending 的仓库名 `block/buzz` 只有 2 个 token，旧公式
// 用重叠系数（除以较短的一边），一个 `block` 就是 0.5，叠上 `titleOverlap * 0.45` 直接
// 到 1.10 —— OpenAI 那篇 2017 年的《Block-sparse GPU kernels》于是成了当天日报的「来源」。
// 完全逐字重复的标题（转载/联合发布）走 exactPhrase 分支，不受这条约束。
const TOPIC_MATCH_MIN_SHARED_TITLE_TOKENS = 2

// Feeds are fetched concurrently, but 29 simultaneous outbound sockets (plus the base
// feed fetch in auto-blog) is enough to trip rate limits and starve the event loop.
const FEED_FETCH_CONCURRENCY = 6
// A feed without Content-Length can stream unbounded data into memory. Cap what we read.
// 这个上限现在也决定了「能从 feed 正文里捞到多少配图」：全文 feed（content:encoded 带
// 整篇正文）单个响应体两三 MB 很常见，调低会直接截断正文、连带丢掉后半篇的插图。
const MAX_FEED_BYTES = 4 * 1024 * 1024

// summary 剥净后的长度上限。此前完全没有截断：雷锋网单条 summary 实测 50732 字符裸 HTML，
// 40 条素材同时留在内存里。剥净之后同样长度装的是真正的正文，1200 字符已经远超下游用量
// （compactResearchItem 截 260、buildEvidenceCard 截 360，主题签名只取前若干 token）。
const MAX_SUMMARY_CHARS = 1200
// 标题超过这个长度的，一定是把正文塞进了 <title>。
const MAX_TITLE_CHARS = 300

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toArray(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

// fast-xml-parser hands back a scalar for `<description>text</description>` but an object
// (`{ '#text': ..., '@_type': 'html' }`) as soon as the element carries an attribute, and an
// array when the element repeats. Blindly String()-ing those produced "[object Object]" and
// comma-joined garbage, so unwrap them explicitly.
function pickNodeText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = pickNodeText(entry)
      if (text) return text
    }
    return ''
  }
  if (typeof value === 'object') {
    if (value['#text'] !== undefined) return pickNodeText(value['#text'])
    if (value['@_href'] !== undefined) return String(value['@_href'])
  }
  return ''
}

// 标签本体删掉、里面的文字留下。`<` 后面必须紧跟字母 / `/` / `!` 才算标签，
// 否则纯文本里的 "5 < 10 and x > 3" 会被整段吃掉。
function stripTagMarkup(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<\/?[a-zA-Z!][^>]*>/g, ' ')
}

/**
 * feed 里的一段原始字段 → 纯文本。
 *
 * RSS 的 description / content 十有八九是整段 HTML（WordPress 系直接塞正文），
 * 之前这段标记原样进了两条下游：
 *   1) 主题签名 —— `style` `margin` `href` `article` `default` 这些标记词被当成主题特征，
 *      两篇毫不相干的稿子靠 HTML 属性名"聚成一簇"；
 *   2) LLM 提示词 —— compactResearchItem 截前 260 字符，模型实际收到的是
 *      `<section style="text-align: center;margin: 0px 16px;…`（雷锋网单条 summary
 *      实测 50732 字符裸标记，真正的正文一个字都没进提示词）。
 * 未解码的实体同理：`&#038;` 在签名里变成一个叫 `038` 的 token。
 *
 * 注意：媒体候选走的是**原始 item 节点**（extractFeedItemMediaCandidates(item)），
 * 从 content:encoded / description 的原始 HTML 里提 `<img>`。两条路径必须分开 ——
 * 在这里剥净只影响 summary/title 字符串，不能顺手把喂给 feed-media 的原文也剥了，
 * 否则 feed 正文图源会被整段掐断（PR#62 的插图供给全靠它）。
 */
export function stripFeedMarkupToText(value, maxChars = 0) {
  let text = String(value || '')
  // 两轮：Atom 的 <content type="html"> 常见二次转义（`&amp;lt;p&amp;gt;`），
  // 剥一轮只剩 `&lt;p&gt;`，解一次才露出标签。两轮封顶，避免把正文里字面写的
  // `&amp;lt;` 无限展开。
  for (let pass = 0; pass < 2 && (text.includes('<') || text.includes('&')); pass += 1) {
    text = decodeFeedEntities(stripTagMarkup(text))
  }
  // 兜底：多重转义时上面两轮之后仍可能残留标签形态。这一轮只剥不解码，
  // 保证交给分词器和 LLM 提示词的一定是纯文本。
  const normalized = normalizeText(stripTagMarkup(text))
  const limit = Number(maxChars)
  if (!Number.isFinite(limit) || limit <= 0 || normalized.length <= limit) return normalized
  // 不要把代理对从中间切开。
  const cut = normalized.slice(0, limit)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

// Atom entries usually carry several <link rel="..."> siblings; the previous
// `item.link?.['@_href'] || item.link` read stringified the whole array into a junk URL.
// Prefer rel="alternate" (the canonical article), then any href, then a plain-string link,
// then the guid — matching how `arxiv.mjs` already resolves entry links.
export function pickEntryLink(item) {
  const links = toArray(item?.link)
  const objectLinks = links.filter((link) => link && typeof link === 'object' && link['@_href'])
  const alternate = objectLinks.find((link) => {
    const rel = String(link['@_rel'] || '').toLowerCase()
    return !rel || rel === 'alternate'
  })
  if (alternate) return String(alternate['@_href'])
  if (objectLinks.length > 0) return String(objectLinks[0]['@_href'])

  const stringLink = links.find((link) => typeof link === 'string' && link.trim())
  if (stringLink) return stringLink.trim()

  return pickNodeText(item?.guid)
}

// Bounded-concurrency variant of Promise.allSettled: same result shape, but at most
// `concurrency` workers are in flight at once.
export async function mapWithConcurrency(items, worker, concurrency = FEED_FETCH_CONCURRENCY) {
  const list = Array.isArray(items) ? items : []
  const results = new Array(list.length)
  const workers = Math.max(1, Math.min(Number(concurrency) || 1, list.length))
  let cursor = 0

  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < list.length) {
      const index = cursor
      cursor += 1
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }))

  return results
}

export async function readResponseTextCapped(resp, maxBytes = MAX_FEED_BYTES) {
  const body = resp?.body
  if (!body || typeof body.getReader !== 'function') {
    const text = await resp.text()
    return text.length > maxBytes ? text.slice(0, maxBytes) : text
  }

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let out = ''
  let total = 0
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength ?? value.length ?? 0
      out += decoder.decode(value, { stream: true })
    }
    out += decoder.decode()
  } finally {
    try {
      await reader.cancel()
    } catch {
      // Stream already finished or errored; nothing to release.
    }
  }
  return out
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function scoreTimestamp(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

function buildCoverageWindowEnd(coverageDate) {
  if (!coverageDate) return Date.now()
  const end = Date.parse(`${coverageDate}T23:59:59Z`)
  return Number.isFinite(end) ? end : Date.now()
}

function normalizeBucket(bucket) {
  return normalizeText(bucket).toLowerCase() || 'community'
}

function normalizeSourceGroup(value, fallback = '') {
  return normalizeText(value || fallback).toLowerCase()
}

function compareResearchItems(left, right, rankItem = (item) => Number(item?.score || 0)) {
  const leftScore = Number(rankItem(left) || 0)
  const rightScore = Number(rankItem(right) || 0)
  if (rightScore !== leftScore) return rightScore - leftScore
  return scoreTimestamp(right?.published_at) - scoreTimestamp(left?.published_at)
}

function dedupeSources(sources) {
  const seen = new Set()
  return (Array.isArray(sources) ? sources : []).filter((source) => {
    const feedUrl = normalizeText(source?.feed_url)
    const name = normalizeText(source?.name)
    if (!feedUrl || !name) return false
    const fingerprint = `${name}|${feedUrl}`.toLowerCase()
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function resolveSourceDiversityConfig(config = {}) {
  const root = config?.source_diversity || {}
  const preferredBucketOrder = Array.isArray(root?.preferred_bucket_order)
    ? root.preferred_bucket_order.map((item) => normalizeBucket(item)).filter(Boolean)
    : []

  return {
    enabled: Boolean(root.enabled ?? true),
    candidateCapPerSource: normalizePositiveInt(root.candidate_cap_per_source, 2),
    enrichmentCapPerSource: normalizePositiveInt(root.enrichment_cap_per_source, 1),
    preferredBucketOrder: preferredBucketOrder.length > 0 ? preferredBucketOrder : [...DEFAULT_BUCKET_ORDER],
  }
}

export function parseFeedXml(xml, source) {
  const parsed = xmlParser.parse(xml)
  const rssItems = toArray(parsed?.rss?.channel?.item)
  const atomItems = toArray(parsed?.feed?.entry)
  const entries = rssItems.length > 0 ? rssItems : atomItems
  const sourceName = normalizeText(source?.name) || normalizeText(source?.tag) || 'unknown'
  const sourceGroup = normalizeSourceGroup(source?.source_group, sourceName)
  const channelBucket = normalizeBucket(source?.channel_bucket)

  return entries
    .map((item) => {
      const url = normalizeText(pickEntryLink(item))
      return {
        source_type: source.source_type || 'independent_blog',
        source_name: sourceName,
        source_group: sourceGroup,
        channel_bucket: channelBucket,
        // 标题也要过一遍：`&#038;` 这类未解码实体会在主题签名里变成一个叫 `038` 的
        // token（事故日志里的 `038-https-qbitai-source-title-url-…` 就是这么来的），
        // 少数源还会往标题里塞 <b>/<i>。
        title: stripFeedMarkupToText(pickNodeText(item.title), MAX_TITLE_CHARS),
        url,
        published_at: normalizeText(
          pickNodeText(item.pubDate) || pickNodeText(item.published) || pickNodeText(item.updated)
        ),
        lang: source.lang || 'en',
        // 只影响这个字符串字段。图片候选读的是上面的原始 `item` 节点，不受影响。
        summary: stripFeedMarkupToText(
          pickNodeText(item.description) || pickNodeText(item.summary) || pickNodeText(item.content),
          MAX_SUMMARY_CHARS,
        ),
        full_text: '',
        // feed 正文里的配图。这份数据本来就随 RSS 一起抓回来了，之前整段丢掉，插图候选
        // 只剩「事后再抓一次源站页面 HTML」这一条路 —— 而那条路会被 JS 注入正文和反爬
        // 打掉一大半。这里的图天然属于这篇文章，不是全站社交卡，相关性也更可靠。
        // 候选仍要过下游的尺寸/黑名单/SSRF 校验，本字段只负责供给。
        media_candidates: extractFeedItemMediaCandidates(item, { baseUrl: url }),
        score: Number(source.quality_weight || 0.5),
        evidence_snippets: [],
      }
    })
    .filter((item) => item.title && item.url)
}

export function dedupeResearchItems(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((item) => {
    const fingerprint = `${item?.url || ''}|${item?.title || ''}`.toLowerCase()
    if (!fingerprint || seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  })
}

export function scoreResearchItem(item, topicHint = '') {
  let score = Number(item.score || 0)
  if (item.source_type === 'official_blog') score += 0.35
  if (item.source_type === 'independent_blog') score += 0.2
  if (item.summary && item.summary.length > 120) score += 0.1
  const topicMatchScore = computeTopicMatchScore(item, topicHint)
  if (topicMatchScore > 0) {
    score += Math.min(1.2, topicMatchScore)
  } else if (topicHint) {
    score -= 0.2
  }
  return Number(score.toFixed(3))
}

/**
 * 一条 blogwatcher 候选与当前选题的相关度。`runBlogwatcher` 在日报模式下用
 * DAILY_TOPIC_MATCH_THRESHOLD 硬过滤这个分数，**过滤剩下的条目会作为正式来源进入
 * researchPack**，被 assessResearchPackSourceSupport 计入 sources / 高质量来源 / 域名数。
 * 也就是说这里判错一次，代价不是「多一条参考链接」，而是替一个本该被跳过的单源选题
 * 伪造出 3 来源 3 域名，让 LLM 去写一篇把三件无关的事硬缝在一起的日报。
 *
 * 2026-07-26 真实语料实测，旧公式的三次误判都发生在**短 hint** 上：
 *   `block/buzz`            × 《Block-sparse GPU kernels》        共同 token 只有 block
 *   `alibaba/open-code-review` × 《Open-sourcing Knowledge Distillation Code…》 open+code
 *   《Monday.com…blame AI for layoffs》× 《AI Agents Are Here. What Now?》 ai+are+here
 * 前两条的病根是重叠系数除以较短的一边（2 个 token 的 hint 撞上 1 个词就是 0.5），
 * 第三条的病根是旧停用词表里没有 `ai` / `are` / `here` 这类词。
 *
 * 两处改动：
 *   1) 分词换成 lib/topic-tokens.mjs 的共用实现 —— 与选题聚类同一张停用词表（`ai`、
 *      `openai`、`model` 都在内），中文走二元切分而不是整段吞，中文 hint 从此真能匹配上。
 *   2) 比值换成对称的 Dice，并要求标题至少共享 TOPIC_MATCH_MIN_SHARED_TITLE_TOKENS 个
 *      token；短 hint 不再能靠一个通用词过线。
 * 输出量纲维持不变（exactPhrase 1.8 + 至多 2.2），DAILY_TOPIC_MATCH_THRESHOLD 保持 0.8，
 * scoreResearchItem 的 Math.min(1.2, …) 封顶也保持不变。
 */
export function computeTopicMatchScore(item, topicHint = '') {
  const normalizedHint = normalizeText(topicHint).toLowerCase()
  if (!normalizedHint) return 0

  const hintTokens = [...new Set(tokenizeTopicText(normalizedHint))]
  if (hintTokens.length === 0) return 0

  const titleText = normalizeText(item?.title || '').toLowerCase()
  const summaryText = normalizeText(item?.summary || '').toLowerCase()
  if (!titleText && !summaryText) return 0

  const titleTokens = [...new Set(tokenizeTopicText(titleText))]
  // 标题里的词也算进正文视图：摘要常常不重复标题里的专名，分开算会把最有判别力的
  // 证据挡在正文视图之外。
  const bodyTokens = [...new Set([...titleTokens, ...tokenizeTopicText(summaryText)])]
  const titleOverlap = countTokenOverlap(hintTokens, titleTokens)
  const exactPhraseBoost = titleText.includes(normalizedHint) ? 1.8 : 0

  const requiredOverlap = Math.min(TOPIC_MATCH_MIN_SHARED_TITLE_TOKENS, hintTokens.length)
  if (exactPhraseBoost === 0 && titleOverlap < requiredOverlap) return 0

  return Number((
    exactPhraseBoost
    + diceCoefficient(hintTokens, titleTokens) * 1.6
    + diceCoefficient(hintTokens, bodyTokens) * 0.6
  ).toFixed(3))
}

export function filterResearchItemsByPublishedWindow(
  items,
  {
    coverageDate = '',
    lookbackHours = 0,
    lookbackDays = 0,
    minItems = 0,
    rankItem = (item) => Number(item?.score || 0),
    // Backfill entries are stale by definition; demote them so they cannot outrank a
    // genuinely fresh item once a downstream stage re-sorts by score.
    backfillPenalty = 0.4,
    logger = null,
  } = {},
) {
  const normalizedItems = dedupeResearchItems(items)
  const totalLookbackMs = Number(lookbackHours) > 0
    ? Number(lookbackHours) * 60 * 60 * 1000
    : Number(lookbackDays) > 0
      ? Number(lookbackDays) * 24 * 60 * 60 * 1000
      : 0

  if (totalLookbackMs <= 0) {
    return normalizedItems.sort((left, right) => compareResearchItems(left, right, rankItem))
  }

  const endTs = buildCoverageWindowEnd(coverageDate)
  const startTs = endTs - totalLookbackMs
  const withTimestamp = []
  const withoutTimestamp = []
  const outsideWindow = []

  for (const item of normalizedItems) {
    const ts = scoreTimestamp(item?.published_at)
    if (ts > 0) {
      if (ts >= startTs && ts <= endTs) withTimestamp.push({ ...item, window_status: 'in_window' })
      else outsideWindow.push(item)
    } else {
      // Feeds such as Hacker News / GitHub Trending routinely omit a publish date. They stay
      // eligible (dropping them would gut the community bucket) but are tagged so downstream
      // reporting can tell "fresh" from "unknown".
      withoutTimestamp.push({ ...item, window_status: 'undated' })
    }
  }

  const primary = [
    ...withTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
    ...withoutTimestamp.sort((left, right) => compareResearchItems(left, right, rankItem)),
  ]

  const floor = Math.max(0, Number(minItems || 0))
  if (primary.length >= floor || outsideWindow.length === 0) return primary

  // The window is a hard filter with a bounded soft backfill: previously a shortfall threw
  // the whole lookback filter away and returned every item, so lookback_hours silently
  // stopped applying. Now we only borrow the few stale items needed to reach `minItems`,
  // and each borrowed item is flagged and score-penalized.
  const shortfall = floor - primary.length
  const backfill = outsideWindow
    .sort((left, right) => compareResearchItems(left, right, rankItem))
    .slice(0, shortfall)
    .map((item) => ({
      ...item,
      window_status: 'outside_lookback_window',
      outside_lookback_window: true,
      score: Number((Number(item?.score || 0) * (1 - Math.min(0.95, Math.max(0, backfillPenalty)))).toFixed(3)),
    }))

  logger?.warn?.(
    `Lookback window backfill: only ${primary.length}/${floor} items inside the window; `
    + `borrowing ${backfill.length} stale item(s) (of ${outsideWindow.length} available).`
  )

  return [...primary, ...backfill]
}

export function interleaveResearchItemsByBucket(
  items,
  {
    preferredBucketOrder = DEFAULT_BUCKET_ORDER,
    rankItem = (item) => Number(item?.score || 0),
  } = {},
) {
  const normalizedPreferredBuckets = preferredBucketOrder.map((bucket) => normalizeBucket(bucket))
  const orderedItems = dedupeResearchItems(items)
    .sort((left, right) => compareResearchItems(left, right, rankItem))
  const bucketQueues = new Map()

  for (const item of orderedItems) {
    const bucket = normalizeBucket(item?.channel_bucket)
    if (!bucketQueues.has(bucket)) bucketQueues.set(bucket, [])
    bucketQueues.get(bucket).push(item)
  }

  const bucketOrder = [
    ...normalizedPreferredBuckets,
    ...[...bucketQueues.keys()].filter((bucket) => !normalizedPreferredBuckets.includes(bucket)),
  ]

  const result = []
  while (result.length < orderedItems.length) {
    let added = false
    for (const bucket of bucketOrder) {
      const queue = bucketQueues.get(bucket)
      if (!queue || queue.length === 0) continue
      result.push(queue.shift())
      added = true
    }
    if (!added) break
  }

  return result
}

export function capResearchItemsPerSource(items, perSourceCap = 0) {
  const normalizedCap = Number(perSourceCap)
  if (!Number.isFinite(normalizedCap) || normalizedCap <= 0) {
    return dedupeResearchItems(items)
  }

  const counts = new Map()
  const results = []
  for (const item of dedupeResearchItems(items)) {
    const key = normalizeSourceGroup(item?.source_group, item?.source_name || item?.url || 'unknown')
    const current = counts.get(key) || 0
    if (current >= normalizedCap) continue
    counts.set(key, current + 1)
    results.push(item)
  }
  return results
}

export function applySourceDiversity(
  items,
  {
    enabled = true,
    preferredBucketOrder = DEFAULT_BUCKET_ORDER,
    perSourceCap = 0,
    maxItems = 0,
    rankItem = (item) => Number(item?.score || 0),
  } = {},
) {
  const baseItems = enabled
    ? capResearchItemsPerSource(
      interleaveResearchItemsByBucket(items, { preferredBucketOrder, rankItem }),
      perSourceCap,
    )
    : dedupeResearchItems(items).sort((left, right) => compareResearchItems(left, right, rankItem))

  const normalizedMaxItems = Number(maxItems)
  if (Number.isFinite(normalizedMaxItems) && normalizedMaxItems > 0) {
    return baseItems.slice(0, normalizedMaxItems)
  }
  return baseItems
}

export function resolveBlogwatcherPlan(config = {}, { mode = 'daily', topicHint = '' } = {}) {
  const weeklyConfig = config.weekly_review || {}
  const isWeeklyReview = mode === 'weekly-review'
  const enabled = Boolean(
    isWeeklyReview ? (weeklyConfig.blogwatcher_enabled ?? config.blogwatcher_enabled) : config.blogwatcher_enabled
  )
  const sources = dedupeSources(
    isWeeklyReview ? (weeklyConfig.blogwatcher_sources || config.blogwatcher_sources) : config.blogwatcher_sources
  )

  return {
    mode,
    topicHint: normalizeText(topicHint),
    enabled,
    maxItems: normalizePositiveInt(
      isWeeklyReview ? weeklyConfig.blogwatcher_max_items : config.blogwatcher_max_items,
      isWeeklyReview ? 12 : 10,
    ),
    sources,
    sourceDiversity: resolveSourceDiversityConfig(config),
    enhanced_source_policy: {
      firecrawl: isWeeklyReview ? (weeklyConfig.firecrawl_mode || 'fallback') : 'off',
      exa: isWeeklyReview ? (weeklyConfig.exa_mode || 'fallback') : 'off',
    },
  }
}

async function fetchFeed(source) {
  const resp = await fetch(source.feed_url, {
    headers: {
      'User-Agent': 'AutoBlogWatcher/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!resp.ok) {
    throw new Error(`feed:${source.name}:${resp.status}`)
  }
  const xml = await readResponseTextCapped(resp)
  return parseFeedXml(xml, source)
}

export async function runBlogwatcher({
  topicHint = '',
  config,
  maxItems,
  mode = 'daily',
  coverageDate = '',
  lookbackHours = 0,
  lookbackDays = 0,
}) {
  const plan = resolveBlogwatcherPlan(config, { mode, topicHint })
  if (!plan.enabled || plan.sources.length === 0) {
    return []
  }

  const settled = await mapWithConcurrency(plan.sources, (source) => fetchFeed(source), FEED_FETCH_CONCURRENCY)
  // 同 auto-blog 的 fetchAllFeeds：静默丢弃失败的源会让「兜底其实没在兜」这件事无法察觉。
  const failed = settled
    .map((result, index) => (result.status === 'rejected'
      ? `${plan.sources[index]?.name}: ${result.reason?.message || result.reason}`
      : ''))
    .filter(Boolean)
  if (failed.length > 0) {
    console.warn(`Blogwatcher: ${failed.length}/${settled.length} source(s) failed: ${failed.join(' | ')}`)
  }
  const scoredItems = settled
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .map((item) => {
      const topicMatchScore = computeTopicMatchScore(item, plan.topicHint)
      return {
        ...item,
        topic_match_score: topicMatchScore,
        score: scoreResearchItem(item, plan.topicHint),
      }
    })

  let items = scoredItems
  if (plan.topicHint) {
    const matchedItems = scoredItems.filter((item) => Number(item.topic_match_score || 0) >= DAILY_TOPIC_MATCH_THRESHOLD)
    if (mode !== 'weekly-review') {
      items = matchedItems
    } else if (matchedItems.length > 0) {
      items = matchedItems
    }
  }

  if (items.length === 0) return []

  const filtered = filterResearchItemsByPublishedWindow(items, {
    coverageDate,
    lookbackHours,
    lookbackDays,
    minItems: Math.min(4, normalizePositiveInt(maxItems, plan.maxItems)),
  })

  return applySourceDiversity(filtered, {
    enabled: plan.sourceDiversity.enabled,
    preferredBucketOrder: plan.sourceDiversity.preferredBucketOrder,
    perSourceCap: plan.sourceDiversity.enrichmentCapPerSource,
    maxItems: normalizePositiveInt(maxItems, plan.maxItems),
    rankItem: (item) => Number(item?.score || 0),
  })
}
