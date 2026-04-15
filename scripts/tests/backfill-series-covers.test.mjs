import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSeriesCoverArgs } from '../backfill-series-covers.mjs'

test('parseSeriesCoverArgs parses and bounds values', () => {
  const parsed = parseSeriesCoverArgs(['--dry-run', '--force', '--limit=999', '--offset=7'])
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.force, true)
  assert.equal(parsed.limit, 200)
  assert.equal(parsed.offset, 7)
})

