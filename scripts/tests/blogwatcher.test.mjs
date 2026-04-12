import test from 'node:test'
import assert from 'node:assert/strict'

import { dedupeResearchItems, parseFeedXml, scoreResearchItem } from '../lib/blogwatcher.mjs'

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
