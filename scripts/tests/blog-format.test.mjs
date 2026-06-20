import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFormatPrompt,
  getBlogFormatProfile,
  getContentWorkflowProfile,
  resolveFormatProfileName,
  neutralizeBannedPhrases,
} from '../lib/blog-format.mjs'

test('getBlogFormatProfile returns the required sections', () => {
  const profile = getBlogFormatProfile()

  assert.equal(profile.name, 'tech-editorial-v1')
  assert.ok(profile.required_sections.includes('## 一、发生了什么'))
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
  assert.ok(profile.banned_phrases.length > 0)
})

test('neutralizeBannedPhrases removes every banned phrase with natural replacements', () => {
  const profile = getBlogFormatProfile()
  const input = '综上所述，这次发布很重要。值得关注的是模型的成本，让我们拭目以待。毋庸置疑，它引发广泛关注。'
  const output = neutralizeBannedPhrases(input)

  for (const phrase of profile.banned_phrases) {
    assert.ok(!output.includes(phrase), `expected banned phrase removed: ${phrase}`)
  }
  assert.ok(output.length > 0)
  assert.ok(output.includes('整体来看'))
})

test('neutralizeBannedPhrases leaves clean text unchanged', () => {
  const input = '这次发布把成本压到了新低，影响波及整个推理市场。'
  assert.equal(neutralizeBannedPhrases(input), input)
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

test('buildFormatPrompt includes deeper editorial quality rule groups', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile())

  assert.match(prompt, /## 章节结构规则/)
  assert.match(prompt, /## 证据使用规则/)
  assert.match(prompt, /## 分析深度规则/)
  assert.match(prompt, /事实说明、重要性判断/)
  assert.match(prompt, /如果这个判断错了/)
})

test('getBlogFormatProfile returns the free-form profile with dimensions', () => {
  const profile = getBlogFormatProfile('free-form-v1')

  assert.equal(profile.name, 'free-form-v1')
  assert.equal(profile.structure_mode, 'free')
  assert.deepEqual(profile.required_sections, [])
  assert.ok(profile.required_dimensions.includes('facts'))
  assert.ok(profile.required_dimensions.includes('judgment'))
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
})

test('buildFormatPrompt renders self-authoring + dimension guidance in free mode', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile('free-form-v1'))

  assert.match(prompt, /## 章节自拟规则/)
  assert.match(prompt, /## 必须覆盖的维度/)
  // It must NOT hand the model a fixed required-section list to fill.
  assert.doesNotMatch(prompt, /## 必备章节/)
  // Tail blocks are still declared as program-appended so the model won't write them.
  assert.match(prompt, /程序补齐的固定尾部/)
  assert.match(prompt, /禁用套话/)
})

test('free-form-v1 is a free-structure profile with no fixed sections', () => {
  const profile = getBlogFormatProfile('free-form-v1')

  assert.equal(profile.name, 'free-form-v1')
  assert.equal(profile.structure_mode, 'free')
  assert.deepEqual(profile.required_sections, [])
  assert.ok(profile.required_dimensions.includes('facts'))
  assert.ok(profile.required_dimensions.includes('judgment'))
  // Tail blocks are still program-appended, so they remain declared.
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
})

test('buildFormatPrompt for free mode asks the LLM to author its own chapters', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile('free-form-v1'))

  assert.match(prompt, /## 章节自拟规则/)
  assert.match(prompt, /## 必须覆盖的维度/)
  // Free mode must NOT present a fixed required-section list.
  assert.doesNotMatch(prompt, /## 必备章节/)
  // The fixed tail blocks are still declared as program-managed.
  assert.match(prompt, /程序补齐的固定尾部/)
  assert.match(prompt, /facts（事实层）/)
})
