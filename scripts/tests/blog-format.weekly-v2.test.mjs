import test from 'node:test'
import assert from 'node:assert/strict'

import { getBlogFormatProfile } from '../lib/blog-format.mjs'

test('weekly-review-v2 exposes the expanded seven-section structure', () => {
  const profile = getBlogFormatProfile('weekly-review-v2')

  assert.equal(profile.name, 'weekly-review-v2')
  assert.equal(profile.required_sections.length, 7)
  assert.ok(profile.required_sections.some((heading) => heading.includes('AI')))
  assert.ok(profile.analysis_markers.length >= 10)
})
