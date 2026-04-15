import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBackfillGate, inferReferenceMetrics, parseBackfillArgs } from '../backfill-quality-snapshots.mjs'

test('parseBackfillArgs parses flags and applies bounds', () => {
  const parsed = parseBackfillArgs(['--dry-run', '--force', '--limit=999', '--offset=5', '--max-pages=0'])
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.force, true)
  assert.equal(parsed.limit, 200)
  assert.equal(parsed.offset, 5)
  assert.equal(parsed.maxPages, 20)
})

test('buildBackfillGate derives minimal metrics from a post', () => {
  const gate = buildBackfillGate({
    source_count: 4,
    content_md: 'This has impact and trade-off analysis.\n\n## References\n- a\n\n## Image Sources\n- b',
  })
  assert.equal(gate.passed, true)
  assert.equal(gate.metrics.source_count, 4)
  assert.ok(gate.metrics.analysis_signal_count >= 1)
  assert.deepEqual(gate.metrics.missing_sections, [])
})

test('inferReferenceMetrics counts markdown references from article body', () => {
  const metrics = inferReferenceMetrics({
    content_md: `## Intro

Body.

## References
- [What is jj and why should I care?](https://news.ycombinator.com/item?id=1) - HackerNews / rss
- [Bringing people together at AI for the Economy Forum](https://blog.google/products/ai/forum/) - Google AI / official_blog
- [New ways to balance cost and reliability in the Gemini API](https://blog.google/products/gemini-api/reliability/) - Google AI / official_blog

## Image Sources
- https://example.com/hero.jpg`,
  })

  assert.equal(metrics.sourceCount, 3)
  assert.ok(metrics.highQualitySourceCount >= 2)
})

test('buildBackfillGate uses inferred references when stored source_count is missing', () => {
  const gate = buildBackfillGate({
    source_count: null,
    content_md: `## References
- [Official launch](https://openai.com/index/launch/) - OpenAI / official_blog
- [Analysis](https://www.semianalysis.com/p/test) - SemiAnalysis / blog
`,
  })

  assert.equal(gate.metrics.source_count, 2)
  assert.ok(gate.metrics.high_quality_source_count >= 1)
})

