import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFormatPrompt, getBlogFormatProfile } from '../lib/blog-format.mjs'

test('getBlogFormatProfile returns the required sections', () => {
  const profile = getBlogFormatProfile()

  assert.equal(profile.name, 'tech-editorial-v1')
  assert.ok(profile.required_sections.includes('## 一、发生了什么'))
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
  assert.ok(profile.banned_phrases.length > 0)
})

test('buildFormatPrompt contains formatting rules', () => {
  const prompt = buildFormatPrompt(getBlogFormatProfile())

  assert.match(prompt, /博客格式规范/)
  assert.match(prompt, /## 必备章节/)
  assert.match(prompt, /## 禁用套话/)
})
