import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPostCoverBrief,
  buildPostCoverPrompt,
  buildSeriesCoverPrompt,
  buildSiteHeroPrompt,
  buildTopicCoverPrompt,
  coverArtVersion,
  presetFramingHint,
} from '../lib/cover-art.mjs'

test('cover art config exposes a stable version and preset framing hints', () => {
  assert.equal(coverArtVersion(), '2026-05-site-hero-editorial-v2')
  assert.match(presetFramingHint('site_hero'), /4:5 vertical homepage hero poster/i)
  assert.match(presetFramingHint('post_cover'), /wide landscape editorial banner/i)
  assert.match(presetFramingHint('series_cover'), /series cover image/i)
  assert.match(presetFramingHint('topic_cover'), /topic cover image/i)
})

test('article cover brief remains content-only while non-article presets retain brand grammar', () => {
  const post = {
    title: 'Agent workflows after MCP',
    summary: '一篇关于 Agent 编排与接口契约的文章。',
    content_md: '## 发生了什么\n\n内容\n\n## 为什么值得关注\n\n内容',
    topic_key: 'agent-workflows',
    tags: ['agent', 'mcp'],
  }
  const postBrief = buildPostCoverBrief(post, { manualBrief: '工具权限与执行速度之间的张力' })
  const legacyPostPrompt = buildPostCoverPrompt(post)
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

  assert.match(postBrief, /Agent workflows after MCP/)
  assert.match(postBrief, /工具权限与执行速度之间的张力/)
  assert.match(postBrief, /发生了什么/)
  assert.equal(postBrief.includes('blue-white editorial technology aesthetic'), false)
  assert.equal(postBrief.includes('glass signal tower'), false)
  assert.equal(postBrief.includes('Strictly exclude'), false)
  assert.ok(postBrief.length <= 700)
  assert.ok(legacyPostPrompt.includes('Use a blue-white editorial technology aesthetic'))

  for (const prompt of [seriesPrompt, topicPrompt, heroPrompt]) {
    assert.ok(prompt.includes('Use a blue-white editorial technology aesthetic'))
    assert.ok(prompt.includes('Strictly exclude readable text'))
  }
})
