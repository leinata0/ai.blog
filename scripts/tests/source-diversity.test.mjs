import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublishingMetadataBridgePayload,
  buildQualitySnapshotPayload,
} from '../auto-blog.mjs'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test('source diversity metadata does not mutate core fields during metadata bridge', () => {
  const post = {
    title: 'A title',
    slug: 'a-title',
    summary: 'A summary',
    cover_image: 'https://example.com/cover.png',
    content_md: 'Body',
    tags: ['ai'],
    content_type: 'daily_brief',
    topic_key: 'agent-tooling',
    published_mode: 'auto',
    coverage_date: '2026-04-15',
  }
  const outline = {
    topic: 'Agent tooling',
    thesis: 'Execution matters',
    key_sources: ['https://example.com/a'],
  }
  const metadata = {
    content_type: 'daily_brief',
    topic_key: 'agent-tooling',
    published_mode: 'auto',
    coverage_date: '2026-04-15',
  }
  const gate = {
    passed: true,
    reasons: [],
    metrics: {
      source_count: 3,
      high_quality_source_count: 1,
      char_count: 2600,
      banned_phrase_hits: 0,
      analysis_signal_count: 3,
      missing_sections: [],
    },
  }
  const researchPack = {
    summary: 'digest',
    sources: [
      {
        source_type: 'official_blog',
        source_name: 'OpenAI Blog',
        source_group: 'openai',
        channel_bucket: 'official_vendor',
        url: 'https://example.com/a',
        title: 'Source A',
        published_at: '2026-04-15T01:00:00Z',
      },
      {
        source_type: 'industry_media',
        source_name: 'TechCrunch AI',
        source_group: 'techcrunch',
        channel_bucket: 'global_media',
        url: 'https://example.com/b',
        title: 'Source B',
        published_at: '2026-04-15T02:00:00Z',
      },
    ],
    blog_items: [],
    paper_items: [],
  }
  const config = {
    quality_gate: {
      daily_brief: {
        min_sources: 2,
        min_high_quality_sources: 1,
        min_chars: 2200,
        max_banned_phrase_hits: 2,
        min_analysis_signals: 3,
      },
    },
    series_assignment: {
      enabled: true,
      default_series_slug: '',
      rules: [],
    },
  }

  const postBefore = clone(post)
  const outlineBefore = clone(outline)
  const payload = buildPublishingMetadataBridgePayload({
    postId: 101,
    post,
    outline,
    metadata,
    gate,
    config,
    researchPack,
    imagePlans: [],
    workflowKey: 'daily_auto',
    coverageDate: '2026-04-15',
    candidateTopics: [{ topic_key: 'agent-tooling', title: 'Agent tooling' }],
  })

  assert.equal(post.title, postBefore.title)
  assert.equal(post.summary, postBefore.summary)
  assert.equal(post.content_md, postBefore.content_md)
  assert.equal(post.cover_image, postBefore.cover_image)
  assert.equal(outline.topic, outlineBefore.topic)
  assert.equal(payload.metadata.source_count, 2)
  assert.deepEqual(payload.post_sources.map((item) => item.source_name), ['OpenAI Blog', 'TechCrunch AI'])
})

test('quality snapshot still computes from source counts when diversity metadata is present', () => {
  const post = {
    title: 'A title',
    slug: 'a-title',
    summary: 'A summary',
    cover_image: 'https://example.com/cover.png',
    content_md: 'Body',
    tags: ['ai'],
    content_type: 'daily_brief',
    topic_key: 'agent-tooling',
    published_mode: 'auto',
    coverage_date: '2026-04-15',
  }
  const postBefore = clone(post)

  const payload = buildQualitySnapshotPayload({
    postId: 101,
    post,
    outline: { topic: 'Agent tooling', thesis: 'Execution matters' },
    metadata: { content_type: 'daily_brief', topic_key: 'agent-tooling', published_mode: 'auto', coverage_date: '2026-04-15' },
    gate: {
      passed: true,
      metrics: {
        source_count: 3,
        high_quality_source_count: 1,
        char_count: 2600,
        banned_phrase_hits: 0,
        analysis_signal_count: 3,
        missing_sections: [],
      },
    },
    config: {
      quality_gate: {
        daily_brief: {
          min_sources: 2,
          min_high_quality_sources: 1,
          min_chars: 2200,
          max_banned_phrase_hits: 2,
          min_analysis_signals: 3,
        },
      },
      series_assignment: { enabled: true, default_series_slug: '', rules: [] },
    },
    researchPack: {
      sources: [
        {
          source_type: 'official_blog',
          source_name: 'OpenAI Blog',
          source_group: 'openai',
          channel_bucket: 'official_vendor',
          url: 'https://example.com/a',
        },
        {
          source_type: 'industry_media',
          source_name: 'MIT Technology Review AI',
          source_group: 'mit-technology-review',
          channel_bucket: 'research_media',
          url: 'https://example.com/b',
        },
      ],
    },
  })

  assert.equal(post.title, postBefore.title)
  assert.equal(post.summary, postBefore.summary)
  assert.equal(post.content_md, postBefore.content_md)
  assert.equal(post.cover_image, postBefore.cover_image)
  assert.equal(typeof payload.quality_snapshot.overall_score, 'number')
  assert.equal(payload.quality_snapshot.source_count, 3)
})
