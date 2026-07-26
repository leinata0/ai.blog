import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
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
  const scored = scoreResearchItem({
    source_type: 'official_blog',
    title: 'Open model launch',
    summary: 'A deep technical summary about model launch behavior.',
    score: 0.8,
  }, 'model')

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
