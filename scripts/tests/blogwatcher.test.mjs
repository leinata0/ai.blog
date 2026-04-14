import test from 'node:test'
import assert from 'node:assert/strict'

import {
  dedupeResearchItems,
  parseFeedXml,
  resolveBlogwatcherPlan,
  scoreResearchItem,
} from '../lib/blogwatcher.mjs'

const source = {
  name: 'Example Feed',
  source_type: 'official_blog',
  lang: 'en',
  quality_weight: 0.9,
}

test('parseFeedXml parses rss items into research items', () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item><title>Model launch</title><link>https://example.com/a</link><description>Detailed analysis</description><pubDate>2026-04-11</pubDate></item>
  </channel></rss>`

  const items = parseFeedXml(xml, source)

  assert.equal(items.length, 1)
  assert.equal(items[0].source_name, 'Example Feed')
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

test('resolveBlogwatcherPlan isolates weekly-review overrides', () => {
  const plan = resolveBlogwatcherPlan({
    blogwatcher_enabled: false,
    blogwatcher_sources: [
      { name: 'Base Blog', feed_url: 'https://base.example/rss.xml' },
    ],
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
  assert.equal(plan.topicHint, 'agents')
})
