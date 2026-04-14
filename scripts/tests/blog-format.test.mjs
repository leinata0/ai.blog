import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFormatPrompt,
  getBlogFormatProfile,
  getContentWorkflowProfile,
  resolveFormatProfileName,
} from '../lib/blog-format.mjs'

test('getBlogFormatProfile returns the required sections', () => {
  const profile = getBlogFormatProfile()

  assert.equal(profile.name, 'tech-editorial-v1')
  assert.ok(profile.required_sections.includes('## 一、发生了什么'))
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
  assert.ok(profile.banned_phrases.length > 0)
})

test('getBlogFormatProfile returns weekly review sections', () => {
  const profile = getBlogFormatProfile('weekly-review-v1')

  assert.equal(profile.name, 'weekly-review-v1')
  assert.ok(profile.required_sections.includes('## 一、本周发生了什么'))
  assert.ok(profile.required_sections.includes('## 五、下周还要继续观察什么'))
  assert.ok(profile.analysis_markers.includes('接下来要观察'))
})

test('resolveFormatProfileName prefers weekly review override', () => {
  const profileName = resolveFormatProfileName({
    format_profile: 'tech-editorial-v1',
    weekly_review: {
      format_profile: 'weekly-review-v1',
    },
  }, 'weekly-review')

  assert.equal(profileName, 'weekly-review-v1')
})

test('getContentWorkflowProfile returns weekly content metadata', () => {
  const workflowProfile = getContentWorkflowProfile({
    weekly_review: {
      format_profile: 'weekly-review-v1',
    },
  }, 'weekly-review', '2026-04-14')

  assert.deepEqual(workflowProfile, {
    mode: 'weekly-review',
    content_type: 'weekly_review',
    profile_name: 'weekly-review-v1',
    slug_prefix: 'ai-weekly-review',
    slug: 'ai-weekly-review-2026-04-14',
  })
})

test('buildFormatPrompt contains formatting rules', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile('weekly-review-v1'))

  assert.match(prompt, /博客格式规范/)
  assert.match(prompt, /## 必备章节/)
  assert.match(prompt, /## 禁用套话/)
  assert.match(prompt, /本周发生了什么/)
})
