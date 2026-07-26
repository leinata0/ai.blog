// 选题分词与主题相似度。**唯一的一份**。
//
// 这份逻辑此前在仓库里存在三份互相漂移的拷贝，同一个 bug 因此被修了三次：
//   1. auto-blog.mjs `relevanceTokens`（插图段落匹配）—— PR#62 修的中文不分词；
//   2. auto-blog.mjs `tokenizeTopicText`（选题聚类）—— 本次事故的主因之一；
//   3. blogwatcher.mjs `tokenizeTopicText`（blogwatcher 兜底的相关性判定）—— 直到现在。
// 第 3 份没跟上前两次修复的后果不是「少匹配几条」：blogwatcher 兜底捞回来的条目会被
// 日报的来源支持门槛当作正式来源计数，一条误匹配就能替一个单源选题凑齐 3 来源 / 3 域名。
// 2026-07-26 的真实语料实测：GitHub Trending 的仓库名 `block/buzz` 靠一个 `block`
// 匹配上 OpenAI 的《Block-sparse GPU kernels》，`alibaba/open-code-review` 靠 `open`+`code`
// 匹配上 HuggingFace 的知识蒸馏文章，三个毫不相干的选题因此通过了门槛。
//
// 所以：谁需要「把一段第三方文本切成主题 token」，就从这里 import，不要再抄第四份。
import { decodeFeedEntities } from './feed-media.mjs'

// 通用到不具备任何判别力的词。厂商名也在内：`openai` / `google` 出现在半数标题里，
// 留着它们等于让任何两条 AI 新闻都「沾亲带故」。
export const DAILY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will',
  'with', 'about', 'after', 'before', 'over', 'under', 'launch', 'launches', 'released',
  'release', 'announces', 'announced', 'introduces', 'introduce', 'new', 'latest', 'today',
  'daily', 'report', 'update', 'updates', 'breaking', 'says', 'say', 'ai', 'llm', 'model',
  'models', 'china', 'openai', 'anthropic', 'google', 'meta', 'microsoft',
])

// 只给选题分词用的兜底黑名单。主力是下面的 stripMarkupForTokens——靠黑名单追杀 HTML
// 标记是追不完的，这里只收「剥完仍可能漏网」的那几个：双重转义残留、内联样式单位、
// URL 里的顶级域。
export const TOPIC_MARKUP_STOP_WORDS = new Set([
  'href', 'src', 'srcset', 'alt', 'style', 'class', 'span', 'div', 'img', 'br', 'ul', 'ol', 'li',
  'td', 'tr', 'th', 'section', 'figure', 'figcaption', 'blockquote', 'iframe', 'noscript',
  'nbsp', 'amp', 'quot', 'apos', 'ldquo', 'rdquo', 'hellip', 'mdash', 'ndash',
  'px', 'pt', 'em', 'rem', 'vw', 'vh', 'rgb', 'rgba', 'margin', 'padding', 'align', 'valign',
  'colspan', 'rowspan', 'sans', 'serif', 'inherit', 'important',
  'http', 'https', 'www', 'url', 'com', 'cn', 'net', 'org', 'html', 'htm', 'utm', 'rel',
  // feed 自身的样板文字。Hacker News 每条 description 都是
  // `Article URL: … Comments URL: … Points: … # Comments: …`，实测最近 8 天 126 条素材里
  // article/url/comments/points 的文档频率都是 15%（= 全部 20 条 HN），三个共同 token 足以
  // 让一条只有 1 个词的 HN 标题（"JetZero"）和任意另一条 HN 相似度达到 0.571。
  // WordPress 的 `The post … appeared first on …` 同理。
  'article', 'comments', 'comment', 'points', 'appeared',
])

function isTopicStopWord(token) {
  return DAILY_STOP_WORDS.has(token) || TOPIC_MARKUP_STOP_WORDS.has(token)
}

// 分词前必须把第三方标记洗掉。`summary` 直接来自 RSS 的 <description>/<content:encoded>，
// 很多源给的是裸 HTML（实测雷锋网单条 50732 字符全是 <section style="...">），`full_text`
// 是 Jina markdown，里面全是链接。不洗的后果不是「多几个噪声 token」——签名只留前 N 个
// token，href / style / margin / px 这些标记词会把真正的正文词整段挤出签名，两篇讲同一件
// 事的稿子于是一个共同 token 都没有。事故当天 10 个候选主题的 topic_key 里全是这类词。
export function stripMarkupForTokens(value) {
  const withoutMarkup = String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
  // 先剥标签再解实体：反过来的话 `&lt;script&gt;` 会被解成真标签再被删掉，等于吃掉正文。
  // 解完再补一次「标签形状」的剥离，是为了双重转义的源（正文里写的是 `&lt;section ...&gt;`）。
  // decodeFeedEntities 与配图链路共用同一张实体表，不共用就会再漂移一次；`&#038;` 不解，
  // 量子位那条标题就会贡献一个名叫 `038` 的 token（事故日志里的 `038-https-qbitai-...`）。
  return decodeFeedEntities(withoutMarkup)
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    // markdown 的图片/链接只保留链接文字，URL 部分是 Jina 全文里最密集的噪声来源。
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.[^\s)>\]]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// 中文没有词边界，`[\u4e00-\u9fff]{2,}` 会把一整串汉字吞成一个 token —— 实测量子位那条标题
// 的签名里，「万小时触觉数据补齐具身智能」是**一个** token。两家媒体报同一件事只要措辞差
// 一个字，共同 token 就是 0，中文来源之间因此从来没有聚成过簇（受控配对实测相似度 0.000）。
// 滑动二元切分不需要词典、不需要额外依赖，auto-blog.mjs 的 relevanceTokens（插图段落匹配）
// 在 PR#62 已经用同一套办法修过同一个 bug。
export function tokenizeTopicText(value) {
  const raw = stripMarkupForTokens(value).toLowerCase()
  const tokens = []
  for (const match of raw.matchAll(/[a-z0-9]{2,}|[\u4e00-\u9fff]+/g)) {
    const chunk = match[0]
    if (chunk.charCodeAt(0) < 0x80) {
      if (!isTopicStopWord(chunk)) tokens.push(chunk)
      continue
    }
    for (let index = 0; index + 2 <= chunk.length; index += 1) {
      const bigram = chunk.slice(index, index + 2)
      if (!isTopicStopWord(bigram)) tokens.push(bigram)
    }
  }
  return tokens
}

export function isLatinToken(token) {
  return /^[a-z0-9]+$/.test(token)
}

export function countTokenOverlap(left, right) {
  const set = new Set(left)
  return right.reduce((count, token) => count + (set.has(token) ? 1 : 0), 0)
}

// 分母的上限。重叠系数原本是 `共同数 / min(|A|,|B|)`，二元切分把签名从 6-10 个 token 拉长到
// 24 个，分子不变而分母翻倍，同一件事的两篇稿子分数反而掉了一半（实测雷锋网×量子位的
// Opus 5 那对：切分前 0.30，切分后 0.125）。签名变长是为了增加「能匹配上」的机会，不该同时
// 抬高「算作同题」的门槛，所以分母封顶：凑够 12 个共同 token 就按完全同题算。
const TOPIC_SIMILARITY_DENOMINATOR_CAP = 12
// 分视图比较时，视图太小就不作数：两条各只有 2 个拉丁 token 且恰好撞上，不构成同题证据。
const TOPIC_LATIN_VIEW_MIN_TOKENS = 3
const TOPIC_CJK_VIEW_MIN_TOKENS = 6

function overlapCoefficient(left, right) {
  if (left.length === 0 || right.length === 0) return 0
  const denominator = Math.min(left.length, right.length, TOPIC_SIMILARITY_DENOMINATOR_CAP)
  return countTokenOverlap(left, right) / denominator
}

function viewSimilarity(left, right, keep, minTokens) {
  const a = left.filter(keep)
  const b = right.filter(keep)
  if (Math.min(a.length, b.length) < minTokens) return 0
  return overlapCoefficient(a, b)
}

// 中文稿的签名里，绝大多数 token 是二元组，拉丁 token 只有寥寥几个 —— 而那几个恰好是最有
// 判别力的专名（opus / fable / gemini / rss）。把它们和二十几个二元组丢进同一个分母，专名
// 证据会被稀释到发现不了：雷锋网《Claude Opus 5 被曝今晚发布》与量子位《半价干翻 Fable 5？
// Opus 5 实测炸场》共享 claude/opus/fable 三个专名，混算只有 0.25，分视图算是 1.000。
// 所以取三个视图的最大值：整体、纯拉丁、纯中文。
// 在最近 8 天全部 126 条素材的 7875 个两两组合上实测：阈值 0.5 命中 12 对，人工核对全部
// 是同一事件的跨源报道，无误并（旧实现在同一批数据上会把 7 条互不相关的中文稿并成一簇）。
export function computeTopicSimilarity(leftTokens, rightTokens) {
  const left = Array.isArray(leftTokens) ? leftTokens : []
  const right = Array.isArray(rightTokens) ? rightTokens : []
  if (left.length === 0 || right.length === 0) return 0
  return Math.max(
    overlapCoefficient(left, right),
    viewSimilarity(left, right, isLatinToken, TOPIC_LATIN_VIEW_MIN_TOKENS),
    viewSimilarity(left, right, (token) => !isLatinToken(token), TOPIC_CJK_VIEW_MIN_TOKENS),
  )
}

// 对称的 Dice 系数。重叠系数（除以较短的一边）在「短查询 vs 长文档」上是病态的：
// 两个 token 的仓库名 `block/buzz` 与任意一篇标题里带 `block` 的文章，重叠系数都是 0.5。
// Dice 把两边长度都算进分母，同一对只有 2*1/(2+4)=0.33。选题聚类比的是两条等价的素材，
// 用重叠系数；blogwatcher 比的是「一个主题 vs 一篇候选文章」，用 Dice。
export function diceCoefficient(left, right) {
  if (left.length === 0 || right.length === 0) return 0
  return (2 * countTokenOverlap(left, right)) / (left.length + right.length)
}
