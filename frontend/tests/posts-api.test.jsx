import { describe, expect, it } from 'vitest'

import { normalizePost } from '../src/api/posts'

describe('normalizePost quality insights', () => {
  it('does not coerce missing quality scores into zeroes', () => {
    const post = normalizePost({
      title: 'Follow-up candidate',
      slug: 'follow-up-candidate',
      summary: 'Summary only',
      content_md: '# Body',
      source_summary: 'Collected from several public references.',
      quality_score: null,
      source_count: null,
      reading_time: null,
      same_topic_posts: [],
    })

    expect(post.quality_insights).not.toBeNull()
    expect(post.quality_insights.overall_score).toBeNull()
    expect(post.quality_insights.structure_score).toBeNull()
    expect(post.quality_insights.source_score).toBeNull()
    expect(post.quality_insights.analysis_score).toBeNull()
  })

  it('prefers persisted quality snapshot values when present', () => {
    const post = normalizePost({
      title: 'Snapshot backed article',
      slug: 'snapshot-backed-article',
      summary: 'Summary',
      content_md: '# Body',
      source_count: 4,
      quality_score: 12,
      reading_time: 3,
      quality_snapshot: {
        overall_score: 91,
        structure_score: 92,
        source_score: 83,
        analysis_score: 87,
        packaging_score: 79,
        resonance_score: 40,
        issues: [],
        strengths: ['deep_analysis'],
        notes: 'Snapshot ready',
      },
    })

    expect(post.quality_insights.has_snapshot).toBe(true)
    expect(post.quality_insights.overall_score).toBe(91)
    expect(post.quality_insights.structure_score).toBe(92)
    expect(post.quality_insights.source_score).toBe(83)
    expect(post.quality_insights.analysis_score).toBe(87)
  })
})
