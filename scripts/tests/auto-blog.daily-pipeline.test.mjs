import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTopicKey,
  clusterResearchItemsByTopic,
  parseCliArgs,
  selectTopicsForPublishing,
} from '../auto-blog.mjs'

test('parseCliArgs understands mode, max-posts and coverage date', () => {
  const result = parseCliArgs([
    '--mode',
    'daily-manual',
    '--max-posts',
    '3',
    '--coverage-date',
    '2026-04-14',
    '--dry-run',
    '--force',
  ])

  assert.deepEqual(result, {
    dryRun: true,
    mode: 'daily-manual',
    maxPosts: 3,
    coverageDate: '2026-04-14',
    force: true,
  })
})

test('buildTopicKey produces stable short keys', () => {
  const key = buildTopicKey({
    title: 'OpenAI launches a new developer agent workflow',
    summary: 'The launch targets developers and code review workflows.',
  })

  assert.ok(key.length > 0)
  assert.ok(key.length <= 80)
})

test('clusterResearchItemsByTopic merges overlapping sources into one topic', () => {
  const clusters = clusterResearchItemsByTopic([
    {
      title: 'OpenAI launches new developer agent',
      summary: 'A new agent workflow for coding teams.',
      full_text: 'OpenAI launches a developer agent for code review workflows.',
      url: 'https://example.com/a',
      source_name: 'A',
      published_at: '2026-04-14T02:00:00Z',
      score: 0.8,
    },
    {
      title: 'New developer agent from OpenAI',
      summary: 'The OpenAI agent is aimed at developer teams.',
      full_text: 'Developer teams can use the new OpenAI agent for review and execution.',
      url: 'https://example.com/b',
      source_name: 'B',
      published_at: '2026-04-14T03:00:00Z',
      score: 0.75,
    },
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].source_count, 2)
})

test('selectTopicsForPublishing skips published topic keys and limits queue size', () => {
  const result = selectTopicsForPublishing(
    [
      { topic_key: 'alpha', source_count: 3, score: 3, latest_published_at: '2026-04-14T03:00:00Z', items: [{}] },
      { topic_key: 'beta', source_count: 2, score: 2, latest_published_at: '2026-04-14T02:00:00Z', items: [{}] },
      { topic_key: 'gamma', source_count: 1, score: 1, latest_published_at: '2026-04-14T01:00:00Z', items: [{}] },
    ],
    {
      maxPosts: 2,
      minSourcesPerTopic: 2,
      publishedTopicKeys: new Set(['alpha']),
    }
  )

  assert.equal(result.queue.length, 2)
  assert.equal(result.queue[0].topic_key, 'beta')
  assert.deepEqual(result.skipped_topic_keys, ['alpha'])
  assert.equal(result.target_count, 2)
})
