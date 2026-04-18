import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPostCoverPrompt,
  buildSeriesCoverPrompt,
  buildSiteHeroPrompt,
  buildTopicCoverPrompt,
  coverArtVersion,
  presetFramingHint,
} from '../lib/cover-art.mjs'

test('cover art config exposes a stable version and preset framing hints', () => {
  assert.equal(coverArtVersion(), '2026-04-editorial-tech-v1')
  assert.match(presetFramingHint('site_hero'), /4:5 vertical editorial poster/i)
  assert.match(presetFramingHint('post_cover'), /wide landscape editorial banner/i)
  assert.match(presetFramingHint('series_cover'), /series cover image/i)
  assert.match(presetFramingHint('topic_cover'), /topic cover image/i)
})

test('shared builders keep the same brand grammar across presets', () => {
  const postPrompt = buildPostCoverPrompt({
    title: 'Agent workflows after MCP',
    summary: '一篇关于 Agent 编排与接口契约的文章。',
    content_md: '## 发生了什么\n\n内容\n\n## 为什么值得关注\n\n内容',
    topic_key: 'agent-workflows',
    tags: ['agent', 'mcp'],
  })
  const seriesPrompt = buildSeriesCoverPrompt({
    title: 'Agent Weekly',
    description: '长期追踪 Agent 工程与产品化。',
  })
  const topicPrompt = buildTopicCoverPrompt({
    title: '推理模型',
    topic_key: 'reasoning-models',
    description: '持续关注推理模型与使用边界。',
  })
  const heroPrompt = buildSiteHeroPrompt({
    author_name: 'AI 资讯观察',
    bio: '持续整理 AI 消息、产品动向和值得长期追踪的主线。',
  })

  for (const prompt of [postPrompt, seriesPrompt, topicPrompt, heroPrompt]) {
    assert.ok(prompt.includes('Use a blue-white editorial technology aesthetic'))
    assert.ok(prompt.includes('Strictly exclude readable text'))
  }
})
