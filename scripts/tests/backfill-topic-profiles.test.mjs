import assert from 'node:assert/strict'
import test from 'node:test'

import { buildBackfillTopicMetadata, parseBackfillTopicArgs } from '../backfill-topic-profiles.mjs'

test('parseBackfillTopicArgs parses and bounds values', () => {
  const parsed = parseBackfillTopicArgs(['--dry-run', '--force', '--with-cover', '--limit=999', '--offset=6', '--max-pages=0'])
  assert.equal(parsed.dryRun, true)
  assert.equal(parsed.force, true)
  assert.equal(parsed.withCover, true)
  assert.equal(parsed.limit, 200)
  assert.equal(parsed.offset, 6)
  assert.equal(parsed.maxPages, 20)
})

test('buildBackfillTopicMetadata returns null when topic_key is missing', () => {
  const payload = buildBackfillTopicMetadata({
    id: 1,
    title: 'No topic key',
  })
  assert.equal(payload, null)
})

test('buildBackfillTopicMetadata builds payload using existing topic_key only', () => {
  const payload = buildBackfillTopicMetadata({
    id: 2,
    slug: 'ai-daily-2026-04-15-agent',
    title: 'Agent trend',
    summary: 'summary',
    topic_key: 'agent-tooling',
    content_type: 'daily_brief',
    coverage_date: '2026-04-15',
    source_count: 4,
  }, {
    topic_presentation: {
      enabled: true,
      rules: [
        {
          topic_key_exact: ['agent-tooling'],
          topic_key_prefixes: [],
          keyword_match: [],
          presentation: {
            zh_title: '智能体演进追踪',
            zh_subtitle: '从能力堆叠到可用产品',
            zh_description: '跟踪 Agent 方向的能力变化与工程落地。',
            zh_tags: ['智能体', '产品化'],
          },
          priority: 100,
        },
      ],
      default_presentation: {
        zh_title_template: '{topic}',
        zh_subtitle_template: '{thesis}',
        zh_description_template: '围绕 {topic} 的持续追踪。',
        zh_tags: ['默认'],
      },
    },
  })

  assert.ok(payload)
  assert.equal(payload.post_id, 2)
  assert.equal(payload.post_slug, 'ai-daily-2026-04-15-agent')
  assert.equal(payload.topic_key, 'agent-tooling')
  assert.equal(payload.topic_metadata.topic_key, 'agent-tooling')
  assert.equal(payload.topic_metadata.source_count, 4)
  assert.equal(payload.topic_metadata.topic_zh_title, '智能体演进追踪')
  assert.equal(payload.topic_metadata.topic_title, '智能体演进追踪')
})
