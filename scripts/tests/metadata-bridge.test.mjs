import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assignSeriesForPost,
  buildTopicPresentation,
  buildPublishingMetadataBridgePayload,
  buildQualitySnapshotPayload,
  buildTopicMetadataPayload,
  estimateReadingTimeMinutes,
} from '../auto-blog.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test('estimateReadingTimeMinutes returns bounded reading time', () => {
  assert.equal(estimateReadingTimeMinutes(''), 1)
  assert.ok(estimateReadingTimeMinutes('This is a long body. '.repeat(300)) >= 2)
})

test('assignSeriesForPost maps weekly content to weekly series rule', () => {
  const decision = assignSeriesForPost({
    post: {
      title: 'AI Weekly Review',
      summary: 'weekly changes across model vendors',
      tags: ['ai'],
    },
    outline: {
      topic: 'weekly AI market review',
      thesis: 'weekly synthesis',
    },
    metadata: {
      content_type: 'weekly_review',
      topic_key: 'ai-weekly-2026-04-15',
    },
    seriesAssignment: {
      enabled: true,
      default_series_slug: '',
      rules: [
        {
          series_slug: 'ai-weekly-review',
          content_types: ['weekly_review'],
          topic_key_prefixes: ['ai-weekly'],
          keyword_match: ['weekly'],
          tag_match: ['ai'],
          default_order: 10,
        },
      ],
    },
  })

  assert.equal(decision.series_slug, 'ai-weekly-review')
  assert.equal(decision.series_order, 10)
})

test('assignSeriesForPost respects manual series override before rules', () => {
  const decision = assignSeriesForPost({
    post: {
      title: 'AI Weekly Review',
      summary: 'weekly changes across model vendors',
      tags: ['ai'],
      series_slug: 'product-strategy-watch',
      series_order: 7,
    },
    outline: {
      topic: 'weekly AI market review',
      thesis: 'weekly synthesis',
    },
    metadata: {
      content_type: 'weekly_review',
      topic_key: 'ai-weekly-2026-04-15',
    },
    seriesAssignment: {
      enabled: true,
      default_series_slug: '',
      rules: [
        {
          series_slug: 'ai-weekly-review',
          content_types: ['weekly_review'],
          topic_key_prefixes: ['ai-weekly'],
          keyword_match: ['weekly'],
          tag_match: ['ai'],
          default_order: 10,
        },
      ],
    },
  })

  assert.equal(decision.series_slug, 'product-strategy-watch')
  assert.equal(decision.series_order, 7)
  assert.equal(decision.matched_rule, 'manual_override')
})

test('metadata bridge payload keeps core post fields unchanged and excludes cover prompt mutation', () => {
  const post = {
    title: 'A title',
    slug: 'a-title',
    summary: 'A summary',
    cover_image: 'https://example.com/cover.png',
    content_md: '## What happened\n\nBody\n\n## References\n\n- a\n\n## Image Sources\n\n- b',
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
    cover_prompt: 'cinematic agent team',
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
      rules: [{ series_slug: 'ai-daily-brief', content_types: ['daily_brief'], default_order: 100, priority: 10 }],
    },
  }
  const researchPack = {
    summary: 'digest',
    sources: [
      { source_type: 'official_blog', source_name: 'OpenAI', url: 'https://example.com/a', title: 'Source A', published_at: '2026-04-15T01:00:00Z' },
      { source_type: 'industry_media', source_name: 'Media', url: 'https://example.com/b', title: 'Source B', published_at: '2026-04-15T02:00:00Z' },
    ],
    blog_items: [],
    paper_items: [],
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
  assert.equal(outline.cover_prompt, outlineBefore.cover_prompt)
  assert.equal(payload.post_id, 101)
  assert.equal(payload.post_slug, 'a-title')
  assert.equal(payload.metadata.source_count, 2)
  assert.equal(payload.metadata.series_slug, 'ai-daily-brief')
  assert.equal(payload.metadata.series_order, 100)
  assert.ok(!payload.publishing_artifact.research_pack_summary.includes('cover_prompt'))
})

test('quality snapshot payload keeps core fields unchanged and exposes required readonly keys', () => {
  const post = { title: 'A title', slug: 'a-title', summary: 'A summary', cover_image: 'https://example.com/cover.png', content_md: 'Body', tags: ['ai'], content_type: 'daily_brief', topic_key: 'agent-tooling', published_mode: 'auto', coverage_date: '2026-04-15' }
  const outline = { topic: 'Agent tooling', thesis: 'Execution matters' }
  const metadata = { content_type: 'daily_brief', topic_key: 'agent-tooling', published_mode: 'auto', coverage_date: '2026-04-15' }
  const gate = { passed: true, metrics: { source_count: 3, high_quality_source_count: 1, char_count: 2600, banned_phrase_hits: 0, analysis_signal_count: 3, missing_sections: [] } }
  const config = { quality_gate: { daily_brief: { min_sources: 2, min_high_quality_sources: 1, min_chars: 2200, max_banned_phrase_hits: 2, min_analysis_signals: 3 } }, series_assignment: { enabled: true, default_series_slug: '', rules: [{ series_slug: 'ai-daily-brief', content_types: ['daily_brief'], default_order: 100 }] } }
  const postBefore = clone(post)

  const payload = buildQualitySnapshotPayload({ postId: 101, post, outline, metadata, gate, config, researchPack: { sources: [{ source_type: 'official_blog', source_name: 'OpenAI', url: 'https://example.com/a' }] } })
  assert.equal(post.title, postBefore.title)
  assert.equal(post.summary, postBefore.summary)
  assert.equal(post.content_md, postBefore.content_md)
  assert.equal(post.cover_image, postBefore.cover_image)
  assert.equal(payload.post_id, 101)
  assert.equal(payload.post_slug, 'a-title')
  assert.equal(typeof payload.quality_snapshot.overall_score, 'number')
})

test('topic metadata payload keeps core fields unchanged and applies rule title first', () => {
  const post = { title: 'A title', slug: 'a-title', summary: 'A summary', cover_image: 'https://example.com/cover.png', content_md: 'Body', tags: ['ai'], content_type: 'daily_brief', topic_key: 'agent-tooling', published_mode: 'auto', coverage_date: '2026-04-15' }
  const outline = { topic: 'Agent tooling', thesis: 'Execution matters' }
  const metadata = { content_type: 'daily_brief', topic_key: 'agent-tooling', published_mode: 'auto', coverage_date: '2026-04-15' }
  const gate = { passed: true, metrics: { source_count: 3, high_quality_source_count: 1, analysis_signal_count: 2, missing_sections: [] } }
  const postBefore = clone(post)

  const payload = buildTopicMetadataPayload({
    postId: 101,
    post,
    outline,
    metadata,
    gate,
    researchPack: { sources: [{ source_name: 'OpenAI', source_type: 'official_blog', url: 'https://example.com/a' }] },
    config: {
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
            topic_family: 'agent',
            priority: 100,
          },
        ],
        default_presentation: {
          zh_title_template: '{topic}',
          zh_subtitle_template: '{thesis}',
          zh_description_template: '围绕 {topic} 的持续追踪。',
          zh_tags: ['AI追踪'],
        },
      },
    },
  })

  assert.equal(post.title, postBefore.title)
  assert.equal(post.summary, postBefore.summary)
  assert.equal(post.content_md, postBefore.content_md)
  assert.equal(post.cover_image, postBefore.cover_image)
  assert.equal(payload.topic_metadata.topic_zh_title, '智能体演进追踪')
  assert.equal(payload.topic_metadata.topic_title, '智能体演进追踪')
})

test('topic metadata payload creates Chinese fallback title when no rule title is available', () => {
  const payload = buildTopicMetadataPayload({
    postId: 201,
    post: {
      title: 'Claude and OpenAI release updates',
      slug: 'updates',
      summary: 'major updates',
      content_md: 'content',
      content_type: 'daily_brief',
      topic_key: 'model-competition',
      coverage_date: '2026-04-15',
    },
    outline: { topic: 'Model race', thesis: 'cost-performance tradeoff' },
    metadata: { content_type: 'daily_brief', topic_key: 'model-competition', coverage_date: '2026-04-15' },
    gate: { passed: true, metrics: {} },
    researchPack: { sources: [] },
    config: { topic_presentation: { enabled: true, rules: [], default_presentation: { zh_title_template: '', zh_subtitle_template: '', zh_description_template: '', zh_tags: [] } } },
  })

  assert.equal(payload.topic_metadata.topic_zh_title, 'AI日报：model competition')
  assert.equal(payload.topic_metadata.topic_title, 'AI日报：model competition')
})

test('topic presentation supports exact/prefix/keyword matching with fallback templates', () => {
  const config = {
    enabled: true,
    rules: [
      { topic_key_exact: ['exact-key'], topic_key_prefixes: [], keyword_match: [], presentation: { zh_title: '精确命中标题', zh_subtitle: '精确命中副标题', zh_description: '精确命中描述', zh_tags: ['精确'] }, topic_family: 'exact', priority: 100 },
      { topic_key_exact: [], topic_key_prefixes: ['prefix-'], keyword_match: [], presentation: { zh_title: '前缀命中标题', zh_subtitle: '前缀命中副标题', zh_description: '前缀命中描述', zh_tags: ['前缀'] }, topic_family: 'prefix', priority: 90 },
      { topic_key_exact: [], topic_key_prefixes: [], keyword_match: ['keyword'], presentation: { zh_title: '关键词命中标题', zh_subtitle: '关键词命中副标题', zh_description: '关键词命中描述', zh_tags: ['关键词'] }, topic_family: 'keyword', priority: 80 },
    ],
    default_presentation: { zh_title_template: '{topic}', zh_subtitle_template: '{thesis}', zh_description_template: '围绕 {topic} 的持续追踪。', zh_tags: ['默认'] },
  }

  assert.equal(buildTopicPresentation({ topicKey: 'exact-key', outline: { topic: 'A', thesis: 'B' }, post: {}, metadata: { content_type: 'daily_brief' }, topicPresentationConfig: config }).zh_title, '精确命中标题')
  assert.equal(buildTopicPresentation({ topicKey: 'prefix-agent', outline: { topic: 'A', thesis: 'B' }, post: {}, metadata: { content_type: 'daily_brief' }, topicPresentationConfig: config }).zh_title, '前缀命中标题')
  assert.equal(buildTopicPresentation({ topicKey: 'random', outline: { topic: 'Contains keyword here', thesis: 'B' }, post: {}, metadata: { content_type: 'daily_brief' }, topicPresentationConfig: config }).zh_title, '关键词命中标题')
  const fallback = buildTopicPresentation({ topicKey: 'none', outline: { topic: '默认标题', thesis: '默认副标题' }, post: {}, metadata: { content_type: 'daily_brief' }, topicPresentationConfig: config })
  assert.equal(fallback.zh_title, '默认标题')
})

test('workflow contracts remain unchanged for script entry and required secrets', async () => {
  const autoWorkflowPath = resolve(__dirname, '..', '..', '.github', 'workflows', 'auto-blog.yml')
  const weeklyWorkflowPath = resolve(__dirname, '..', '..', '.github', 'workflows', 'weekly-review.yml')
  const [autoWorkflow, weeklyWorkflow] = await Promise.all([readFile(autoWorkflowPath, 'utf8'), readFile(weeklyWorkflowPath, 'utf8')])

  assert.ok(autoWorkflow.includes('name: AI 日报自动发文'))
  assert.ok(autoWorkflow.includes('SILICONFLOW_API_KEY'))
  assert.ok(autoWorkflow.includes('ADMIN_PASSWORD'))
  assert.ok(autoWorkflow.includes('node scripts/auto-blog.mjs'))
  assert.ok(autoWorkflow.includes('--mode daily-auto'))

  assert.ok(weeklyWorkflow.includes('name: AI 周报自动生成'))
  assert.ok(weeklyWorkflow.includes('SILICONFLOW_API_KEY'))
  assert.ok(weeklyWorkflow.includes('ADMIN_PASSWORD'))
  assert.ok(weeklyWorkflow.includes('node scripts/auto-blog.mjs'))
  assert.ok(weeklyWorkflow.includes('--mode weekly-review'))
})
