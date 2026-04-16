import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applySourceDiversity,
  computeTopicMatchScore,
  dedupeResearchItems,
  filterResearchItemsByPublishedWindow,
  parseFeedXml,
  resolveBlogwatcherPlan,
  resolveSourceDiversityConfig,
  scoreResearchItem,
} from '../lib/blogwatcher.mjs'

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
