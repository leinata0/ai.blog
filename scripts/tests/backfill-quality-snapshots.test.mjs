import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBackfillGate, parseBackfillArgs } from '../backfill-quality-snapshots.mjs'

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

