import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DAILY_TOPIC_MATCH_THRESHOLD,
  applySourceDiversity,
  computeTopicMatchScore,
  dedupeResearchItems,
  filterResearchItemsByPublishedWindow,
  mapWithConcurrency,
  parseFeedXml,
  pickEntryLink,
  readResponseTextCapped,
  resolveBlogwatcherPlan,
  resolveSourceDiversityConfig,
  scoreResearchItem,
  stripFeedMarkupToText,
} from '../lib/blogwatcher.mjs'

const FEED_FIXTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'feeds')

const source = {
  name: 'Example Feed',
  source_type: 'official_blog',
  lang: 'en',
  quality_weight: 0.9,
  channel_bucket: 'official_vendor',
  source_group: 'example-feed',
}

test('parseFeedXml parses rss items into research items with source metadata', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item><title>Model launch</title><link>https://example.com/a</link><description>Detailed analysis</description><pubDate>2026-04-11</pubDate></item>
  </channel></rss>`

  const items = parseFeedXml(xml, source)

  assert.equal(items.length, 1)
  assert.equal(items[0].source_name, 'Example Feed')
  assert.equal(items[0].source_group, 'example-feed')
  assert.equal(items[0].channel_bucket, 'official_vendor')
  assert.equal(items[0].url, 'https://example.com/a')
})

test('dedupeResearchItems removes duplicate title-url pairs', () => {
  const deduped = dedupeResearchItems([
    { url: 'https://example.com/a', title: 'Same' },
    { url: 'https://example.com/a', title: 'Same' },
    { url: 'https://example.com/b', title: 'Different' },
  ])

  assert.equal(deduped.length, 2)
})

test('scoreResearchItem favors official sources and topic matches', () => {
  // The hint used to be the single word "model". It is a stop word in the shared topic
  // tokenizer (it appears in roughly half of all AI headlines and carries no discriminative
  // power), so a one-word hint made of stop words now yields no tokens and no match at all.
  // Use a hint with real content words, which is what runBlogwatcher actually passes:
  // topicHint is a full candidate headline, never a single generic noun.
  const scored = scoreResearchItem({
    source_type: 'official_blog',
    title: 'Agents SDK adds enterprise sandboxing',
    summary: 'A deep technical summary about the Agents SDK sandboxing behavior for enterprises.',
    score: 0.8,
  }, 'Agents SDK enterprise sandboxing')

  assert.ok(scored > 1.2)
})

test('computeTopicMatchScore rejects unrelated filler and rewards real topic overlap', () => {
  const matched = computeTopicMatchScore({
    title: 'OpenAI updates its Agents SDK to help enterprises build safer agents',
    summary: 'The update adds enterprise controls and safer agent execution.',
  }, 'OpenAI Agents SDK')
  const unrelated = computeTopicMatchScore({
    title: 'Backpack review for commuters',
    summary: 'A hardware carry review for everyday commute.',
  }, 'OpenAI Agents SDK')

  assert.ok(matched > 0.5)
  assert.equal(unrelated, 0)
})

// Regression for the 2026-07-26 daily run. Items that clear DAILY_TOPIC_MATCH_THRESHOLD are
// appended to the topic's researchPack and counted by assessResearchPackSourceSupport, so a
// loose match does not add a footnote — it manufactures the 3 sources / 3 domains the gate
// asks for. All four hint/item pairs below are verbatim from that day's corpus; every one of
// them scored above the 0.8 threshold under the old count-based formula.
test('computeTopicMatchScore refuses a match built on one generic shared word', () => {
  const rejected = [
    // Overlap coefficient divides by the shorter side, so a 2-token hint sharing one word
    // scored 0.5 there and 1.10 overall. `block` is the only thing these have in common.
    ['block/buzz', {
      title: 'Block-sparse GPU kernels',
      summary: 'We are releasing highly optimized GPU kernels for block-sparse matrices.',
    }],
    // `open` + `code` are two shared words, so the min-shared-token floor alone does not
    // reject this one; the symmetric Dice coefficient drops it under the bar.
    ['alibaba/open-code-review', {
      title: 'Open-sourcing Knowledge Distillation Code and Weights of SD-Small and SD-Tiny',
      summary: 'We release the code and weights for distilled Stable Diffusion checkpoints.',
    }],
    // `ai` / `are` / `here` were absent from the old blogwatcher stop-word list; the shared
    // list drops all three.
    ['Monday.com is the latest tech company to blame AI for layoffs — here are 20 others', {
      title: 'AI Agents Are Here. What Now?',
      summary: 'A look at where agent tooling is heading.',
    }],
    ['Librarians are hosting viral ‘Avoiding AI’ workshops for people who are fed up with Big Tech', {
      title: 'NVIDIA NVLink: The Scale-Up Network for AI Factories',
      summary: 'How NVLink scales up inside the rack.',
    }],
  ]

  for (const [hint, item] of rejected) {
    const score = computeTopicMatchScore(item, hint)
    assert.ok(
      score < DAILY_TOPIC_MATCH_THRESHOLD,
      `"${item.title}" must not be admitted as a source for "${hint}" (scored ${score})`,
    )
  }
})

test('computeTopicMatchScore still matches the same story across outlets', () => {
  // Same story, different outlet: this pair must survive the tightening or the blogwatcher
  // fallback stops supplying anything at all.
  const sameStory = computeTopicMatchScore({
    title: 'Ruff v0.16.0',
    summary: 'Astral shipped Ruff v0.16.0 with 413 default rules, up from 59.',
  }, 'Ruff v0.16.0 – Significant new updates – 413 default rules up from 59')
  assert.ok(sameStory >= DAILY_TOPIC_MATCH_THRESHOLD, `expected a same-story match, got ${sameStory}`)

  // Chinese hints used to be tokenized as one indivisible run of Han characters, so they
  // could only ever match through the exact-phrase branch. Bigrams make a reworded headline
  // about the same event matchable.
  const chinese = computeTopicMatchScore({
    title: '吴恩达开源个人桌面 Agent，代码全量公开',
    summary: '这个个人桌面 Agent 项目 100% 开源，本地优先、模型无关。',
  }, '100%开源！吴恩达做了个个人桌面Agent')
  assert.ok(chinese >= DAILY_TOPIC_MATCH_THRESHOLD, `expected a Chinese same-story match, got ${chinese}`)

  // Negative control on the same axis: two unrelated Chinese headlines must stay at zero,
  // so the bigram tokenizer cannot be accused of buying recall with precision.
  assert.equal(computeTopicMatchScore({
    title: '手冲咖啡指北：天太热了，来做一杯不寡淡的冰手冲吧',
    summary: '从粉水比到水温，聊聊夏天的冰手冲。',
  }, '100%开源！吴恩达做了个个人桌面Agent'), 0)
})

test('resolveSourceDiversityConfig returns the default soft-diversity policy', () => {
  const config = resolveSourceDiversityConfig({})

  assert.equal(config.enabled, true)
  assert.equal(config.candidateCapPerSource, 2)
  assert.equal(config.enrichmentCapPerSource, 1)
  assert.deepEqual(config.preferredBucketOrder, [
    'official_vendor',
    'global_media',
    'research_media',
    'independent',
    'cn_ai_media',
    'community',
  ])
})

test('filterResearchItemsByPublishedWindow prefers fresh items and only appends undated fallback', () => {
  const filtered = filterResearchItemsByPublishedWindow([
    {
      title: 'Fresh official update',
      url: 'https://example.com/fresh',
      published_at: '2026-04-16T08:00:00Z',
      score: 1,
    },
    {
      title: 'Old official update',
      url: 'https://example.com/old',
      published_at: '2026-04-02T08:00:00Z',
      score: 10,
    },
    {
      title: 'Undated community note',
      url: 'https://example.com/undated',
      published_at: '',
      score: 0.3,
    },
  ], {
    coverageDate: '2026-04-16',
    lookbackHours: 30,
    minItems: 1,
  })

  assert.equal(filtered.length, 2)
  assert.equal(filtered[0].title, 'Fresh official update')
  assert.equal(filtered[1].title, 'Undated community note')
})

test('applySourceDiversity interleaves buckets and caps per source', () => {
  const items = applySourceDiversity([
    { title: 'OpenAI one', url: 'https://example.com/openai-1', source_name: 'OpenAI Blog', source_group: 'openai', channel_bucket: 'official_vendor', score: 0.9, published_at: '2026-04-16T08:00:00Z' },
    { title: 'OpenAI two', url: 'https://example.com/openai-2', source_name: 'OpenAI Blog', source_group: 'openai', channel_bucket: 'official_vendor', score: 0.8, published_at: '2026-04-16T07:00:00Z' },
    { title: 'OpenAI three', url: 'https://example.com/openai-3', source_name: 'OpenAI Blog', source_group: 'openai', channel_bucket: 'official_vendor', score: 0.7, published_at: '2026-04-16T06:00:00Z' },
    { title: 'TechCrunch', url: 'https://example.com/techcrunch', source_name: 'TechCrunch AI', source_group: 'techcrunch', channel_bucket: 'global_media', score: 0.85, published_at: '2026-04-16T05:00:00Z' },
    { title: 'Leiphone', url: 'https://example.com/leiphone', source_name: 'Leiphone', source_group: 'leiphone', channel_bucket: 'cn_ai_media', score: 0.75, published_at: '2026-04-16T04:00:00Z' },
  ], {
    preferredBucketOrder: ['official_vendor', 'global_media', 'cn_ai_media'],
    perSourceCap: 2,
    maxItems: 4,
    rankItem: (item) => item.score,
  })

  assert.deepEqual(items.map((item) => item.title), [
    'OpenAI one',
    'TechCrunch',
    'Leiphone',
    'OpenAI two',
  ])
})

test('resolveBlogwatcherPlan isolates weekly-review overrides', () => {
  const plan = resolveBlogwatcherPlan({
    blogwatcher_enabled: false,
    blogwatcher_sources: [
      { name: 'Base Blog', feed_url: 'https://base.example/rss.xml' },
    ],
    source_diversity: {
      enabled: true,
      candidate_cap_per_source: 3,
      enrichment_cap_per_source: 2,
      preferred_bucket_order: ['global_media', 'official_vendor'],
    },
    weekly_review: {
      blogwatcher_enabled: true,
      blogwatcher_max_items: 6,
      firecrawl_mode: 'fallback',
      exa_mode: 'fallback',
      blogwatcher_sources: [
        { name: 'Weekly Blog', feed_url: 'https://weekly.example/rss.xml' },
        { name: 'Weekly Blog', feed_url: 'https://weekly.example/rss.xml' },
      ],
    },
  }, { mode: 'weekly-review', topicHint: 'agents' })

  assert.equal(plan.enabled, true)
  assert.equal(plan.maxItems, 6)
  assert.equal(plan.sources.length, 1)
  assert.equal(plan.sources[0].name, 'Weekly Blog')
  assert.equal(plan.enhanced_source_policy.firecrawl, 'fallback')
  assert.equal(plan.enhanced_source_policy.exa, 'fallback')
  assert.equal(plan.sourceDiversity.enrichmentCapPerSource, 2)
  assert.equal(plan.topicHint, 'agents')
})

// --- P1-8 / P2-15: parsing robustness, hard lookback window, bounded concurrency ---

test('parseFeedXml resolves atom entries with multiple rel links instead of joining them', () => {
  const xml = `<?xml version="1.0"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Atom entry</title>
      <link rel="edit" href="https://example.com/edit/1"/>
      <link rel="alternate" type="text/html" href="https://example.com/post/1"/>
      <summary type="html">A summary with markup</summary>
      <updated>2026-04-11T00:00:00Z</updated>
    </entry>
  </feed>`

  const items = parseFeedXml(xml, source)

  assert.equal(items.length, 1)
  assert.equal(items[0].url, 'https://example.com/post/1')
  assert.equal(items[0].summary, 'A summary with markup')
  assert.ok(!items[0].url.includes(','))
})

test('parseFeedXml unwraps attributed description/title nodes instead of stringifying objects', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item>
      <title type="text">Model launch</title>
      <link>https://example.com/a</link>
      <description type="html"><![CDATA[Detailed analysis of the launch]]></description>
      <pubDate>2026-04-11</pubDate>
    </item>
  </channel></rss>`

  const items = parseFeedXml(xml, source)

  assert.equal(items[0].title, 'Model launch')
  assert.equal(items[0].summary, 'Detailed analysis of the launch')
  assert.ok(!items[0].summary.includes('[object Object]'))
})

test('pickEntryLink falls back to guid when no usable link element exists', () => {
  assert.equal(pickEntryLink({ guid: { '#text': 'https://example.com/guid' } }), 'https://example.com/guid')
  assert.equal(pickEntryLink({ link: 'https://example.com/plain' }), 'https://example.com/plain')
  assert.equal(pickEntryLink({}), '')
})

test('lookback window stays enforced when the window is under-filled', () => {
  const warnings = []
  const filtered = filterResearchItemsByPublishedWindow([
    { title: 'Fresh', url: 'https://example.com/fresh', published_at: '2026-04-16T08:00:00Z', score: 1 },
    { title: 'Stale A', url: 'https://example.com/stale-a', published_at: '2026-01-02T08:00:00Z', score: 10 },
    { title: 'Stale B', url: 'https://example.com/stale-b', published_at: '2026-01-03T08:00:00Z', score: 9 },
    { title: 'Stale C', url: 'https://example.com/stale-c', published_at: '2026-01-04T08:00:00Z', score: 8 },
  ], {
    coverageDate: '2026-04-16',
    lookbackHours: 30,
    minItems: 3,
    logger: { warn: (message) => warnings.push(message) },
  })

  // Old behaviour: the whole filter was discarded and all 4 stale items came back at full
  // score. Now only the shortfall (3 - 1 = 2) is borrowed, flagged and demoted.
  assert.equal(filtered.length, 3)
  assert.equal(filtered[0].title, 'Fresh')
  assert.equal(filtered[0].window_status, 'in_window')
  const backfilled = filtered.slice(1)
  assert.equal(backfilled.length, 2)
  assert.ok(backfilled.every((item) => item.outside_lookback_window === true))
  assert.ok(backfilled.every((item) => item.window_status === 'outside_lookback_window'))
  assert.ok(backfilled[0].score < 10, 'backfilled items must be score-penalized')
  assert.equal(warnings.length, 1)
})

test('lookback window does not backfill when enough fresh items exist', () => {
  const filtered = filterResearchItemsByPublishedWindow([
    { title: 'Fresh A', url: 'https://example.com/a', published_at: '2026-04-16T08:00:00Z', score: 1 },
    { title: 'Fresh B', url: 'https://example.com/b', published_at: '2026-04-16T06:00:00Z', score: 2 },
    { title: 'Stale', url: 'https://example.com/stale', published_at: '2026-01-02T08:00:00Z', score: 99 },
  ], {
    coverageDate: '2026-04-16',
    lookbackHours: 30,
    minItems: 2,
  })

  assert.deepEqual(filtered.map((item) => item.title), ['Fresh B', 'Fresh A'])
  assert.ok(filtered.every((item) => !item.outside_lookback_window))
})

test('mapWithConcurrency preserves order and never exceeds the concurrency limit', async () => {
  let active = 0
  let peak = 0
  const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], async (value) => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((done) => setTimeout(done, 1))
    active -= 1
    if (value === 3) throw new Error('boom')
    return value * 2
  }, 2)

  assert.equal(peak <= 2, true, `peak concurrency was ${peak}`)
  assert.equal(results.length, 7)
  assert.equal(results[0].value, 2)
  assert.equal(results[2].status, 'rejected')
  assert.equal(results[6].value, 14)
})

// --- 插图供给：feed 正文里的配图不再被丢掉 ---

test('parseFeedXml 把 feed 正文里的配图挂到 item.media_candidates 上', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'wordpress-content-encoded.xml'), 'utf8')

  const [item] = parseFeedXml(xml, source)

  // 这份数据本来就随 RSS 一起抓回来了，之前整段丢掉，插图候选只剩「事后再抓一次源站
  // 页面 HTML」一条路 —— 而那条路会被 JS 注入正文、付费墙和反爬打掉一大半。
  assert.ok(Array.isArray(item.media_candidates))
  assert.ok(item.media_candidates.length >= 3, `expected feed-content candidates, got ${item.media_candidates.length}`)
  assert.ok(item.media_candidates.some((candidate) => candidate.kind === 'feed-content'))
  assert.ok(item.media_candidates.every((candidate) => candidate.url.startsWith('https://')))
  // 相对路径要按这条 item 的文章链接补全，而不是原样留着导致下游取不到图。
  assert.ok(item.media_candidates.some((candidate) => (
    candidate.url === 'https://techcrunch.com/wp-content/uploads/2026/07/inference-cost-chart.png'
  )))
})

test('parseFeedXml 对没有配图的 feed 给出空候选，其余字段不受影响', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'text-only-no-media.xml'), 'utf8')

  const items = parseFeedXml(xml, source)

  assert.equal(items.length, 2)
  assert.ok(items.every((item) => Array.isArray(item.media_candidates) && item.media_candidates.length === 0))
  assert.equal(items[0].title, 'Show HN: A tiny inference server written in Zig')
  assert.equal(items[0].url, 'https://github.com/example/zig-infer')
})

test('parseFeedXml 用 Atom 的 rel="alternate" 作为 media_candidates 的相对路径基准', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'atom-escaped-content.xml'), 'utf8')

  const [item] = parseFeedXml(xml, source)

  // link 被解析成数组时若拼成逗号串，baseUrl 就是垃圾，所有相对路径的图会一起失效。
  assert.equal(item.url, 'https://huggingface.co/blog/jfrog')
  assert.ok(item.media_candidates.some((candidate) => (
    candidate.url === 'https://huggingface.co/blog/assets/jfrog/scan-pipeline-diagram.png'
  )))
})

test('readResponseTextCapped stops reading once the byte cap is reached', async () => {
  const chunks = [new TextEncoder().encode('a'.repeat(64)), new TextEncoder().encode('b'.repeat(64))]
  let cancelled = false
  let index = 0
  const resp = {
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined }
            const value = chunks[index]
            index += 1
            return { done: false, value }
          },
          async cancel() { cancelled = true },
        }
      },
    },
    async text() { throw new Error('should not fall back to text()') },
  }

  const text = await readResponseTextCapped(resp, 64)
  assert.equal(text.length, 64)
  assert.equal(cancelled, true)
})

// --- 素材文本质量：进分词器 / LLM 提示词的必须是纯文本 ---

test('stripFeedMarkupToText 剥标签、解实体、压空白，并且不动纯文本里的比较符号', () => {
  assert.equal(stripFeedMarkupToText('<p>段落一</p>\n<p>段落二</p>'), '段落一 段落二')
  // <script>/<style> 里的 URL 不是正文，整块删掉；HTML 注释同理。
  assert.equal(
    stripFeedMarkupToText('<p>x</p><script>var u="https://tracker.example/a.js"</script><style>.a{color:red}</style><!-- 撤稿 --><p>y</p>'),
    'x y',
  )
  // 实体解码：`&#038;` 不解就会在主题签名里变成一个叫 `038` 的 token。
  assert.equal(stripFeedMarkupToText('新智具身&#038;复旦&#8220;三连发&#8221;'), '新智具身&复旦“三连发”')
  // Atom 的 <content type="html"> 常见二次转义，解一轮还剩标签。
  assert.equal(stripFeedMarkupToText('&amp;lt;p&amp;gt;double&amp;lt;/p&amp;gt;'), 'double')
  // `<` 后面不是字母/斜杠/叹号就不算标签，纯文本的比较式必须原样保留。
  assert.equal(stripFeedMarkupToText('a &lt; b and c &gt; d'), 'a < b and c > d')
  assert.equal(stripFeedMarkupToText('5 < 10 and x > 3'), '5 < 10 and x > 3')
  // 截断不允许把代理对从中间切开。
  assert.equal(stripFeedMarkupToText('abcdefghij', 4), 'abcd')
  assert.equal(stripFeedMarkupToText('😀😀😀', 1), '')
  assert.equal(stripFeedMarkupToText('', 100), '')
})

test('parseFeedXml 把中文 HTML 摘要剥成正文，同时 media_candidates 仍从原始 HTML 提到图', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'cn-html-summary-entities.xml'), 'utf8')

  const [rich, plain] = parseFeedXml(xml, source)

  // 1) 标题：二次转义的实体要还原，否则 `038` / `8220` 会被当成主题特征词
  //    （事故日志的 `038-https-qbitai-source-title-url-64e4cd75` 就是这么来的）。
  assert.equal(rich.title, '3万小时触觉数据补齐具身智能“手感”！新智具身&复旦报告三连发')
  assert.ok(!rich.title.includes('&#'))

  // 2) summary：只剩正文，HTML/CSS 标记词一个不留。
  assert.equal(
    rich.summary,
    '新智具身与复旦大学联合发布三份报告，公开了 3 万小时的真机触觉采集数据。 项目数据、模型与代码均已开源，训练脚本同步放出。',
  )
  for (const marker of ['<', 'section', 'style', 'margin', 'text-align', 'data-mpa', 'rich_pages']) {
    assert.ok(!rich.summary.includes(marker), `summary 里不该出现 ${marker}`)
  }

  // 3) 同时成立：配图仍然从**原始 HTML** 里提出来（中文源站惯用的 data-src 懒加载写法），
  //    URL 里的 `&#038;` 照旧由 feed-media 解码。剥 summary 不能掐断这条供给。
  assert.equal(rich.media_candidates.length, 1)
  assert.equal(
    rich.media_candidates[0].url,
    'https://static.leiphone.com/uploads/new/images/20260726/6a65cae5a33d9.png?imageView2/2/w/740&q=90',
  )
  assert.equal(rich.media_candidates[0].alt, '触觉数据集采集现场')

  // 4) 纯文本摘要不许被动：`&lt;` / `&gt;` 还原出的比较符号不能被当成标签吃掉。
  assert.equal(plain.summary, '当 batch < 8 时吞吐反而更低，> 32 之后收益递减。A < B and C > D 都要原样保留。')
  assert.equal(plain.media_candidates.length, 0)
})

test('parseFeedXml 对 WordPress / MediaRSS / Atom 摘要同样只留正文，配图数量不变', async () => {
  const wordpress = parseFeedXml(
    await readFile(resolve(FEED_FIXTURE_DIR, 'wordpress-content-encoded.xml'), 'utf8'),
    source,
  )
  // description 是 `<p>正文</p><img …>`：正文留下、img 标签消失，但图还在候选里。
  assert.equal(wordpress[0].summary, 'Google is developing a new inference accelerator for Gemini.')
  assert.ok(wordpress[0].media_candidates.length >= 3)

  const mediaRss = parseFeedXml(
    await readFile(resolve(FEED_FIXTURE_DIR, 'media-rss-description.xml'), 'utf8'),
    source,
  )
  // 这条的 description 以 <img> 开头，之前 LLM 提示词的前 260 字符几乎全是 img 属性。
  assert.equal(mediaRss[0].summary, 'Enterprises can now feed a full quarter of support tickets into a single request.')
  assert.equal(mediaRss[0].media_candidates.length, 3)

  const atom = parseFeedXml(
    await readFile(resolve(FEED_FIXTURE_DIR, 'atom-escaped-content.xml'), 'utf8'),
    source,
  )
  assert.equal(atom[0].summary, 'A joint scanning pipeline for public model weights.')

  // Hacker News 的 description 只有一个转义的评论链接，剥完只剩 "Comments"，
  // 而不是 `a href https news ycombinator com item id` 这一串 URL 碎片。
  const hn = parseFeedXml(
    await readFile(resolve(FEED_FIXTURE_DIR, 'text-only-no-media.xml'), 'utf8'),
    source,
  )
  assert.equal(hn[0].summary, 'Comments')
  assert.equal(
    hn[1].summary,
    'A back-of-the-envelope breakdown of accelerator hours, memory bandwidth and network egress.',
  )
})

test('parseFeedXml 不再被 fast-xml-parser 的实体展开上限打掉整个全文源', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'entity-dense-fulltext.xml'), 'utf8')

  // 默认的 processEntities（boolean 形态）把 maxTotalExpansions 卡在 1000，而这个计数器
  // 是整篇文档累计的：AWS ML / GitHub Trending / MIT News / Simon Willison 四个源因此
  // 整体 throw，被 fetchAllFeeds 的 .filter(fulfilled) 静默吃掉，线上少了 118 条素材。
  const items = parseFeedXml(xml, source)

  assert.equal(items.length, 6)
  assert.ok(items.every((item) => item.title && item.url))
  assert.ok(items[0].summary.startsWith('Step 1: GET /v1/infer?m=1&region=us-east-1'))
  assert.ok(!items[0].summary.includes('<p'))
})

test('parseFeedXml 给 summary 加长度上限，避免整篇裸 HTML 正文进内存和提示词', async () => {
  const xml = await readFile(resolve(FEED_FIXTURE_DIR, 'entity-dense-fulltext.xml'), 'utf8')

  const items = parseFeedXml(xml, source)

  // 雷锋网单条 summary 实测 50732 字符裸标记，此前完全不截断。
  assert.ok(items.every((item) => item.summary.length <= 1200))
  assert.equal(items[0].summary.length, 1200)
})
