import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { XMLParser } from 'fast-xml-parser'

import {
  decodeFeedEntities,
  extractFeedItemMediaCandidates,
  extractImageCandidatesFromMarkup,
  extractMarkdownImageCandidates,
  mergeMediaCandidates,
} from '../lib/feed-media.mjs'

// ---------------------------------------------------------------------------
// 覆盖率修复的供给侧回归：RSS 的 <content:encoded> 和 Jina 的 markdown 里本来就带着
// 这篇文章自己的配图，之前被整段丢掉，插图候选只剩「事后再抓一次源站页面 HTML」一条路。
//
// fixtures/feeds/ 下的 XML 按真实 feed 的结构写（WordPress/Jetpack 的 CDATA + `&#038;`
// 转义、Atom 的实体转义正文 + 多个 <link rel>、Media RSS 的 media:content/enclosure、
// 以及完全没有图的纯文本 feed），不是理想化的合成样例 —— 生产里出问题的正是这些细节。
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = resolve(__dirname, 'fixtures', 'feeds')

// 与 blogwatcher.mjs 完全相同的解析器配置：键名带不带命名空间前缀直接决定
// content:encoded 能不能被读到，测试必须用同一份配置。
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

async function firstEntry(file) {
  const parsed = xmlParser.parse(await readFile(resolve(FIXTURE_DIR, file), 'utf8'))
  const items = parsed?.rss?.channel?.item ?? parsed?.feed?.entry
  return Array.isArray(items) ? items[0] : items
}

function urlsOf(candidates) {
  return candidates.map((candidate) => candidate.url)
}

test('content:encoded 的多张正文图都被提取，CDATA/实体/相对路径都还原正确', async () => {
  const entry = await firstEntry('wordpress-content-encoded.xml')
  const baseUrl = 'https://techcrunch.com/2026/07/20/google-is-working-on-a-new-ai-chip-designed-to-make-gemini-more-efficient/'
  const candidates = extractFeedItemMediaCandidates(entry, { baseUrl })

  const hero = candidates.find((item) => item.url.includes('tpu-rack.jpg?w=1024'))
  assert.ok(hero, 'content:encoded 里的首图必须进入候选')
  // Jetpack 把查询串分隔符写成 `&#038;`；不解码就会变成一个名叫 `#038;ssl` 的参数，
  // 同一张图的两个 rendition 于是拿到两个不同的去重键。
  assert.equal(hero.url, 'https://techcrunch.com/wp-content/uploads/2026/07/tpu-rack.jpg?w=1024&ssl=1')
  assert.ok(!hero.url.includes('#038'))
  assert.equal(hero.kind, 'feed-content')
  assert.equal(hero.field, 'content:encoded')
  assert.equal(hero.width, 1024)
  assert.equal(hero.height, 576)
  assert.equal(hero.inArticle, true)
  assert.equal(hero.inFigure, true)
  assert.equal(hero.hasCaption, true)

  // 站内相对路径要用这条 item 的文章链接补全，否则整张图直接丢失。
  const chart = candidates.find((item) => item.url.endsWith('/inference-cost-chart.png'))
  assert.ok(chart, '相对路径的正文图必须被解析成绝对 URL')
  assert.equal(chart.url, 'https://techcrunch.com/wp-content/uploads/2026/07/inference-cost-chart.png')

  // description 里的首图也要收，很多源站只在 description 给图。
  const fromDescription = candidates.find((item) => item.url.includes('gemini-icon.jpg'))
  assert.ok(fromDescription)
  assert.equal(fromDescription.kind, 'feed-summary')
  assert.equal(fromDescription.field, 'description')
})

test('figcaption 与相邻正文被一并带出，中文说明文字不丢', async () => {
  const entry = await firstEntry('wordpress-content-encoded.xml')
  const candidates = extractFeedItemMediaCandidates(entry, {
    baseUrl: 'https://techcrunch.com/2026/07/20/google-is-working-on-a-new-ai-chip-designed-to-make-gemini-more-efficient/',
  })

  // 中文章节标题 vs 英文图片 URL 的子串匹配命中率约等于零。figcaption 和相邻段落是这张图
  // 唯一一份自然语言描述，相关性打分能不能真的生效，取决于这两个字段有没有内容。
  const chart = candidates.find((item) => item.url.endsWith('/inference-cost-chart.png'))
  assert.equal(chart.caption, '推理成本随芯片代际下降的曲线，纵轴为每百万 token 的美元成本。')
  assert.ok(chart.context.includes('inference chip'))
  assert.ok(!chart.caption.includes('<'), 'figcaption 里的标签必须剥掉')

  const hero = candidates.find((item) => item.url.includes('tpu-rack.jpg?w=1024'))
  assert.ok(hero.caption.includes('TPU 机架'))
})

test('feed 统计像素、FeedBurner 计数图、注释与脚本里的 URL 全部不进候选', async () => {
  const entry = await firstEntry('wordpress-content-encoded.xml')
  const urls = urlsOf(extractFeedItemMediaCandidates(entry, {
    baseUrl: 'https://techcrunch.com/2026/07/20/google-is-working-on-a-new-ai-chip-designed-to-make-gemini-more-efficient/',
  }))

  // 1x1 beacon 和 FeedBurner 计数图只在 feed 正文里出现，页面侧的规则不认识它们。
  assert.ok(!urls.some((url) => url.includes('pixel.wp.com')))
  assert.ok(!urls.some((url) => url.includes('feeds.feedburner.com')))
  // 被编辑撤下的图藏在 HTML 注释里，<script> 里的字符串也不是插图。
  assert.ok(!urls.some((url) => url.includes('pulled-draft')))
  assert.ok(!urls.some((url) => url.includes('ads.example.com')))
})

test('srcset 里最大的 rendition 单独入列，并按自己的宽度记账', async () => {
  const entry = await firstEntry('wordpress-content-encoded.xml')
  const candidates = extractFeedItemMediaCandidates(entry, {
    baseUrl: 'https://techcrunch.com/2026/07/20/google-is-working-on-a-new-ai-chip-designed-to-make-gemini-more-efficient/',
  })

  const large = candidates.find((item) => item.url.includes('tpu-rack.jpg?w=1536'))
  assert.ok(large, 'srcset 里的大图必须单独作为候选，否则 min_width 会误杀')
  assert.equal(large.width, 1536)
  assert.equal(large.responsive, true)
  // 768w 只是更小的 rendition，没有保留价值。
  assert.ok(!urlsOf(candidates).some((url) => url.includes('w=768')))
})

test('Atom 的实体转义正文（含 &amp;#038;）与懒加载 data-src 都能读出来', async () => {
  const entry = await firstEntry('atom-escaped-content.xml')
  const candidates = extractFeedItemMediaCandidates(entry, { baseUrl: 'https://huggingface.co/blog/jfrog' })
  const urls = urlsOf(candidates)

  // Atom 用实体转义而不是 CDATA 包正文：解析器先把 &lt;img&gt; 还原成标签，
  // 属性里剩下的 &#038; 由本模块解码，一共一次，不做二次展开。
  assert.ok(urls.includes('https://cdn-uploads.huggingface.co/production/uploads/jfrog/detection-banner.png?w=1200&fit=1200%2C630'))
  assert.ok(!urls.some((url) => url.includes('#038')))

  const diagram = candidates.find((item) => item.url.endsWith('scan-pipeline-diagram.png'))
  assert.equal(diagram.field, 'content')
  assert.equal(diagram.hasCaption, true)
  assert.ok(diagram.caption.includes('扫描流水线'))

  // src 是占位图、真图在 data-src 的站点很多，两个写法都入列，用哪个交给下游规则。
  assert.ok(urls.includes('https://huggingface.co/front/assets/placeholder.svg'))
})

test('Media RSS 的 media:content / media:thumbnail 收进来，音频 enclosure 不收', async () => {
  const entry = await firstEntry('media-rss-description.xml')
  const candidates = extractFeedItemMediaCandidates(entry, {
    baseUrl: 'https://venturebeat.com/ai/anthropic-ships-a-longer-context-claude-for-enterprise-retrieval/',
  })
  const urls = urlsOf(candidates)

  assert.ok(urls.includes('https://venturebeat.com/wp-content/uploads/2026/07/claude-enterprise-hero.jpg'))
  assert.ok(urls.includes('https://venturebeat.com/wp-content/uploads/2026/07/context-window-benchmark.jpg'))
  // 同一个位置也可能挂播客音频，type 不是 image/* 就不是插图。
  assert.ok(!urls.some((url) => url.endsWith('.mp3')))

  const structured = candidates.find((item) => item.field === 'media:content')
  assert.equal(structured.alt, 'Claude 企业版控制台截图')
  assert.equal(structured.width, 1200)
  // 结构化声明没有版式信息，位置信号一律留空，不替下游伪造 inFigure/inArticle 加分。
  assert.equal(structured.inArticle, false)
  assert.equal(structured.inFigure, false)
})

test('完全没有图的 feed 返回空数组而不是抛错或造图', async () => {
  const entry = await firstEntry('text-only-no-media.xml')

  assert.deepEqual(extractFeedItemMediaCandidates(entry, { baseUrl: 'https://github.com/example/zig-infer' }), [])
  assert.deepEqual(extractFeedItemMediaCandidates(null), [])
  assert.deepEqual(extractFeedItemMediaCandidates({}, { baseUrl: 'https://example.com/a' }), [])
})

test('内网地址、非 http(s) 协议和目录型 URL 在这一层就被挡掉', () => {
  const markup = `
    <p><img src="http://169.254.169.254/latest/meta-data/img.png" alt="metadata" width="800" height="600" /></p>
    <p><img src="http://localhost:8000/internal.png" alt="internal" width="800" height="600" /></p>
    <p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="inline" width="800" height="600" /></p>
    <p><img src="https://cdn.example.com/photos/" alt="directory" width="800" height="600" /></p>
    <p><img src="https://cdn.example.com/photos/real.jpg" alt="real" width="800" height="600" /></p>
  `
  const urls = urlsOf(extractImageCandidatesFromMarkup(markup, 'https://example.com/post/1'))

  // 下游还会再过一遍 SSRF 校验；这里挡住只是让候选列表从一开始就不含明显不可用的目标。
  assert.deepEqual(urls, ['https://cdn.example.com/photos/real.jpg'])
})

test('单条 item 的候选数量有上限，长文不会把候选列表撑爆', () => {
  const markup = Array.from({ length: 40 }, (_, index) => (
    `<p><img src="https://cdn.example.com/photos/pic-${index}.jpg" alt="pic ${index}" width="1200" height="800" /></p>`
  )).join('\n')

  const candidates = extractImageCandidatesFromMarkup(markup, 'https://example.com/post/1')
  assert.equal(candidates.length, 12)
  assert.equal(candidates[0].url, 'https://cdn.example.com/photos/pic-0.jpg')
})

test('extractMarkdownImageCandidates 读出 Jina markdown 里的配图', () => {
  // r.jina.ai（Accept: text/markdown）的真实输出形态：图片带 `Image N:` 编号前缀，
  // 常见 `[![alt](图)](链接)` 的嵌套写法，正文里也可能混着原始 <img>。
  const markdown = `Title: Anthropic ships longer-context Claude

URL Source: https://venturebeat.com/ai/claude-long-context/

Markdown Content:
![Image 1: VentureBeat logo](https://venturebeat.com/wp-content/themes/vb-news/img/logo.svg)

Enterprises can now feed a full quarter of support tickets into a single request.

[![Image 4: Chart comparing retrieval accuracy across context lengths](https://venturebeat.com/wp-content/uploads/2026/07/retrieval-accuracy.jpg)](https://venturebeat.com/ai/claude-long-context/)

Benchmarks below.

\`\`\`markdown
![not a real illustration](https://example.com/docs/sample-in-code-block.png)
\`\`\`

<img src="/wp-content/uploads/2026/07/latency-breakdown.png" alt="Latency breakdown" width="1200" height="600" />
`
  const candidates = extractMarkdownImageCandidates(markdown, 'https://venturebeat.com/ai/claude-long-context/')
  const urls = urlsOf(candidates)

  assert.ok(urls.includes('https://venturebeat.com/wp-content/uploads/2026/07/retrieval-accuracy.jpg'))
  // 相对路径按文章链接补全，原始 <img> 也走同一套属性解析。
  assert.ok(urls.includes('https://venturebeat.com/wp-content/uploads/2026/07/latency-breakdown.png'))
  // 代码块里的示例图是被讨论的对象，不是这篇文章的配图。
  assert.ok(!urls.some((url) => url.includes('sample-in-code-block')))

  const chart = candidates.find((item) => item.url.endsWith('retrieval-accuracy.jpg'))
  assert.equal(chart.kind, 'article-markdown')
  assert.equal(chart.origin, 'markdown')
  // `Image 4: ` 是 Jina 的编号，不是描述；剥掉之后剩下的才是可用于相关性匹配的 alt。
  assert.equal(chart.alt, 'Chart comparing retrieval accuracy across context lengths')
  assert.ok(chart.context.includes('support tickets'))
})

test('mergeMediaCandidates 按 URL 合并并保留信息更全的那一条', () => {
  const merged = mergeMediaCandidates(
    [{ url: 'https://cdn.example.com/a.jpg', alt: '', caption: '', context: '', width: 0, height: 0, className: '', inFigure: false, hasCaption: false, responsive: false }],
    [{ url: 'https://cdn.example.com/a.jpg', alt: '图注', caption: '配图说明', context: '上下文', width: 1200, height: 675, className: 'wp-image-1', inFigure: true, hasCaption: true, responsive: true }],
    [{ url: 'https://cdn.example.com/b.jpg', alt: 'b', caption: '', context: '', width: 800, height: 400, className: '', inFigure: false, hasCaption: false, responsive: false }],
  )

  assert.equal(merged.length, 2)
  const first = merged[0]
  // 同一张图会同时出现在 content:encoded、description 和 media:content 里，
  // 三处的信息量不同：先到先得会把 figcaption 或精确宽高丢掉。
  assert.equal(first.alt, '图注')
  assert.equal(first.caption, '配图说明')
  assert.equal(first.width, 1200)
  assert.equal(first.hasCaption, true)
})

test('decodeFeedEntities 只解一次，不把 &amp;#038; 展开成 &', () => {
  assert.equal(decodeFeedEntities('a&#038;b'), 'a&b')
  assert.equal(decodeFeedEntities('a&amp;#038;b'), 'a&#038;b')
  assert.equal(decodeFeedEntities('a&#x26;b'), 'a&b')
  assert.equal(decodeFeedEntities('a&notarealentity;b'), 'a&notarealentity;b')
})
