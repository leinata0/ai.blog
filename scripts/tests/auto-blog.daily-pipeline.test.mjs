import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTopicKey,
  clusterResearchItemsByTopic,
  createDailyBriefFormatProfile,
  filterItemsForCoverageWindow,
  parseCliArgs,
  pickPostCountForRun,
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

test('pickPostCountForRun randomizes daily auto count between min and max', () => {
  assert.equal(pickPostCountForRun({ mode: 'daily-auto', minPosts: 1, maxPosts: 2, randomValue: 0.1 }), 1)
  assert.equal(pickPostCountForRun({ mode: 'daily-auto', minPosts: 1, maxPosts: 2, randomValue: 0.9 }), 2)
  assert.equal(pickPostCountForRun({ mode: 'daily-manual', minPosts: 1, maxPosts: 3, randomValue: 0.1 }), 3)
})

test('createDailyBriefFormatProfile keeps the full long-form section structure', () => {
  const profile = createDailyBriefFormatProfile()

  assert.equal(profile.required_sections.length, 5)
  assert.ok(profile.required_sections.every((section) => section.startsWith('## ')))
})

test('filterItemsForCoverageWindow respects lookback_hours and keeps undated fallback behind fresh items', () => {
  const items = filterItemsForCoverageWindow([
    {
      title: 'Fresh official update',
      summary: 'fresh',
      full_text: 'fresh',
      url: 'https://example.com/fresh',
      source_name: 'OpenAI Blog',
      published_at: '2026-04-16T08:00:00Z',
      score: 0.9,
    },
    {
      title: 'Old official update',
      summary: 'old',
      full_text: 'old',
      url: 'https://example.com/old',
      source_name: 'Google AI',
      published_at: '2026-04-02T08:00:00Z',
      score: 1.2,
    },
    {
      title: 'Undated note',
      summary: 'undated',
      full_text: 'undated',
      url: 'https://example.com/undated',
      source_name: 'Hacker News',
      published_at: '',
      score: 0.2,
    },
  ], {
    coverageDate: '2026-04-16',
    lookbackHours: 30,
    minItems: 1,
  })

  assert.deepEqual(items.map((item) => item.title), [
    'Fresh official update',
    'Undated note',
  ])
})

test('clusterResearchItemsByTopic merges overlapping sources and records diversity stats', () => {
  const clusters = clusterResearchItemsByTopic([
    {
      title: 'OpenAI launches new developer agent',
      summary: 'A new agent workflow for coding teams.',
      full_text: 'OpenAI launches a developer agent for code review workflows.',
      url: 'https://example.com/a',
      source_name: 'OpenAI Blog',
      source_group: 'openai',
      channel_bucket: 'official_vendor',
      published_at: '2026-04-14T02:00:00Z',
      score: 0.8,
    },
    {
      title: 'New developer agent from OpenAI',
      summary: 'The OpenAI agent is aimed at developer teams.',
      full_text: 'Developer teams can use the new OpenAI agent for review and execution.',
      url: 'https://example.com/b',
      source_name: 'TechCrunch AI',
      source_group: 'techcrunch',
      channel_bucket: 'global_media',
      published_at: '2026-04-14T03:00:00Z',
      score: 0.75,
    },
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].source_count, 2)
  assert.equal(clusters[0].bucket_count, 2)
  assert.equal(clusters[0].non_official_source_count, 1)
  assert.deepEqual([...clusters[0].source_groups].sort(), ['openai', 'techcrunch'])
})

test('selectTopicsForPublishing favors diverse topics when source counts are close', () => {
  const result = selectTopicsForPublishing(
    [
      {
        topic_key: 'single-official',
        source_count: 3,
        bucket_count: 1,
        non_official_source_count: 0,
        score: 3,
        latest_published_at: '2026-04-14T03:00:00Z',
        items: [{}],
      },
      {
        topic_key: 'mixed-viewpoints',
        source_count: 3,
        bucket_count: 3,
        non_official_source_count: 2,
        score: 2.9,
        latest_published_at: '2026-04-14T02:00:00Z',
        items: [{}],
      },
      {
        topic_key: 'below-threshold',
        source_count: 1,
        bucket_count: 1,
        non_official_source_count: 1,
        score: 5,
        latest_published_at: '2026-04-14T04:00:00Z',
        items: [{}],
      },
    ],
    {
      maxPosts: 2,
      minSourcesPerTopic: 2,
      publishedTopicKeys: new Set([]),
    },
  )

  assert.equal(result.queue.length, 3)
  assert.equal(result.queue[0].topic_key, 'mixed-viewpoints')
  assert.equal(result.queue[2].topic_key, 'below-threshold')
  assert.equal(result.target_count, 2)
})
