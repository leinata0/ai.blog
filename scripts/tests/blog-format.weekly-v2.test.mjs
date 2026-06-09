import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFormatPrompt, getBlogFormatProfile } from '../lib/blog-format.mjs'

test('weekly-review-v2 exposes the expanded seven-section structure', () => {
  const profile = getBlogFormatProfile('weekly-review-v2')

  assert.equal(profile.name, 'weekly-review-v2')
  assert.equal(profile.required_sections.length, 7)
  assert.ok(profile.required_sections.some((heading) => heading.includes('AI')))
  assert.ok(profile.analysis_markers.length >= 10)
})

test('weekly-review-v2 prompt emphasizes axes, disagreement and watch variables', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile('weekly-review-v2'))

  assert.match(prompt, /三条清晰主线/)
  assert.match(prompt, /分歧与争议/)
  assert.match(prompt, /长周期视角/)
  assert.match(prompt, /观察变量/)
})
