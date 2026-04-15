import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildHeuristicCoverPrompt,
  buildPromptContext,
  extractHeadings,
  sanitizeCoverPrompt,
} from '../generate-cover-for-post.mjs'

test('extractHeadings returns section headings in order', () => {
  const headings = extractHeadings(`# Title

## One
body
### Nested
## Two
## Three`)
  assert.deepEqual(headings, ['One', 'Nested', 'Two', 'Three'])
})

test('sanitizeCoverPrompt removes wrapping quotes and repeated prefix', () => {
  const prompt = sanitizeCoverPrompt('"Wide landscape banner image, cinematic, high quality: futuristic AI newsroom with glowing dashboards"')
  assert.equal(prompt, 'futuristic AI newsroom with glowing dashboards')
})

test('buildPromptContext extracts stable cover prompt context', () => {
  const context = buildPromptContext({
    title: 'Google AI 三维战略：从政策影响到技术民主化的深层布局',
    summary: '一篇分析 Google AI 多线布局的文章。',
    content_md: '## 一、发生了什么\n\n内容\n\n## 二、为什么值得关注\n\n更多内容',
    tags: [{ name: 'google' }, { slug: 'ai' }],
    content_type: 'daily_brief',
  })
  assert.equal(context.title.includes('Google AI'), true)
  assert.equal(context.headings.length, 2)
  assert.deepEqual(context.tags, ['google', 'ai'])
})

test('buildHeuristicCoverPrompt builds a non-empty editorial prompt', () => {
  const prompt = buildHeuristicCoverPrompt({
    title: '旧博客迁移到 Neon + R2',
    summary: '讲一次博客架构迁移和数据持久化升级。',
    content_md: '## 一、问题\n\n内容\n\n## 二、迁移方案\n\n内容',
    tags: ['devops', 'neon', 'cloudflare'],
  })
  assert.ok(prompt.includes('Editorial hero illustration'))
  assert.ok(prompt.includes('Neon + R2'))
  assert.ok(prompt.includes('wide website banner'))
})
