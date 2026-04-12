import test from 'node:test'
import assert from 'node:assert/strict'

import { parseArxivFeed } from '../lib/arxiv.mjs'

test('parseArxivFeed extracts arxiv entries', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/1234.5678v1</id>
      <updated>2026-04-11T00:00:00Z</updated>
      <published>2026-04-10T00:00:00Z</published>
      <title>Efficient Agents at Scale</title>
      <summary>We study agent orchestration.</summary>
      <author><name>Alice</name></author>
      <author><name>Bob</name></author>
      <link href="http://arxiv.org/abs/1234.5678v1" rel="alternate" type="text/html" />
      <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI" />
    </entry>
  </feed>`

  const items = parseArxivFeed(xml)

  assert.equal(items.length, 1)
  assert.equal(items[0].source_type, 'paper')
  assert.equal(items[0].authors.length, 2)
  assert.equal(items[0].primary_category, 'cs.AI')
})
