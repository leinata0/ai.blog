import test from 'node:test'
import assert from 'node:assert/strict'

import { createDailyBriefFormatProfile } from '../auto-blog.mjs'
import { getBlogFormatProfile } from '../lib/blog-format.mjs'
import { evaluateQualityGate } from '../lib/quality-gate.mjs'

const formatProfile = getBlogFormatProfile()
const config = {
  quality_gate: {
    min_sources: 3,
    min_high_quality_sources: 1,
    high_quality_source_types: ['official_blog', 'paper'],
    min_chars: 20,
    max_banned_phrase_hits: 0,
    min_analysis_signals: 1,
  },
}

function buildArticle(profile, bodies, tailItems = ['- a', '- b']) {
  const lines = []
  profile.required_sections.forEach((heading, index) => {
    lines.push(heading, bodies[index] || `段落 ${index + 1}`)
  })
  profile.required_tail_sections.forEach((heading, index) => {
    lines.push(heading, tailItems[index] || `- tail-${index + 1}`)
  })
  return lines.join('\n\n')
}

test('quality gate passes for a sufficiently structured post', () => {
  const result = evaluateQualityGate({
    post: {
      content_md: buildArticle(formatProfile, [
        `这件事意味着工程实践的入口已经发生变化，团队会先从试点能力开始落地。`,
        '值得关注的不是一次发布本身，而是成本、速度与风险开始被重新组合。',
        '官方博客与行业媒体的判断并不完全一致，这让取舍问题变得更具体。',
        '如果结合历史脉络来看，论文能力到产品能力之间始终存在明显落差。',
        '我的判断是，真正关键的影响仍然落在组织协作和执行效率上。',
      ]),
    },
    researchPack: {
      sources: [
        { source_type: 'official_blog' },
        { source_type: 'industry_media' },
        { source_type: 'paper' },
      ],
    },
    formatProfile,
    config,
  })

  assert.equal(result.passed, true)
})

test('quality gate validates inline source grounding when configured', () => {
  const result = evaluateQualityGate({
    post: {
      content_md: buildArticle(formatProfile, [
        'OpenAI 发布说明给出了事实背景。[S1]',
        '独立博客补充了开发者影响，因此这个变化意味着入口竞争更激烈。[S2]',
        '不同来源的取舍集中在速度、成本与组织风险。[S1] [S2]',
        '论文背景说明能力迁移仍有工程落差。[S3]',
        '我的判断是影响会先落在开发工具链。[S2]',
      ]),
    },
    researchPack: {
      sources: [
        { source_id: 'S1', source_type: 'official_blog', url: 'https://openai.com/a' },
        { source_id: 'S2', source_type: 'industry_media', url: 'https://example.com/b' },
        { source_id: 'S3', source_type: 'paper', url: 'https://arxiv.org/abs/1' },
      ],
    },
    formatProfile,
    config: {
      quality_gate: {
        min_sources: 3,
        min_high_quality_sources: 1,
        high_quality_source_types: ['official_blog', 'paper'],
        min_chars: 20,
        max_banned_phrase_hits: 1,
        min_analysis_signals: 1,
        min_inline_citations: 4,
        min_cited_sources: 3,
        min_cited_domains: 3,
        require_section_citations: true,
      },
    },
  })

  assert.equal(result.passed, true)
  assert.equal(result.metrics.cited_source_count, 3)
  assert.equal(result.metrics.cited_domain_count, 3)
})

test('quality gate rejects invalid citation markers', () => {
  const result = evaluateQualityGate({
    post: { content_md: buildArticle(formatProfile, ['事实来自未知来源。[S99]']) },
    researchPack: { sources: [{ source_id: 'S1', source_type: 'official_blog', url: 'https://openai.com/a' }] },
    formatProfile,
    config: {
      quality_gate: {
        min_sources: 1,
        min_high_quality_sources: 1,
        high_quality_source_types: ['official_blog'],
        min_chars: 1,
        max_banned_phrase_hits: 1,
        min_analysis_signals: 0,
        min_inline_citations: 1,
      },
    },
  })

  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.startsWith('invalid_citations:')))
})

test('quality gate rejects post with missing sections', () => {
  const result = evaluateQualityGate({
    post: { content_md: `${formatProfile.required_sections[0]}\n\n让我们拭目以待。` },
    researchPack: { sources: [{ source_type: 'industry_media' }] },
    formatProfile,
    config,
  })

  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.startsWith('missing_sections:')))
})

test('quality gate resolves nested daily brief rules from content type', () => {
  const dailyProfile = createDailyBriefFormatProfile()
  const dailyMarkers = dailyProfile.analysis_markers.slice(0, 3)
  const result = evaluateQualityGate({
    post: {
      content_type: 'daily_brief',
      gate_profile: 'daily_brief',
      content_md: buildArticle(
        dailyProfile,
        [
          `OpenAI 发布了新的开发者代理能力，${dailyMarkers[0]}工具开始从演示走向真实工作流。`,
          `值得关注的不只是速度提升，${dailyMarkers[1]}也落在团队权限边界与稳定性上。`,
          `官方博客强调集成效率，行业媒体则更关心价格与组织替代，这就是${dailyMarkers[2]}。`,
          '如果把它放回更长的历史脉络，代理能力正在把代码补全工具推向主动执行。',
          '我的判断是，真正的竞争会从模型参数转向谁能占住开发入口。',
        ],
        ['- a', '- 无正文插图']
      ),
    },
    researchPack: {
      sources: [
        { source_type: 'official_blog' },
        { source_type: 'industry_media' },
      ],
    },
    formatProfile: dailyProfile,
    config: {
      quality_gate: {
        daily_brief: {
          min_sources: 2,
          min_high_quality_sources: 1,
          high_quality_source_types: ['official_blog'],
          min_chars: 30,
          max_banned_phrase_hits: 0,
          min_analysis_signals: 2,
        },
      },
    },
  })

  assert.equal(result.passed, true)
})

test('quality gate counts repeated analysis markers by occurrences', () => {
  const weeklyProfile = getBlogFormatProfile('weekly-review-v2')
  const markers = weeklyProfile.analysis_markers.slice(0, 4)
  const result = evaluateQualityGate({
    post: {
      content_type: 'weekly_review',
      gate_profile: 'weekly_review',
      content_md: buildArticle(
        weeklyProfile,
        [
          `${markers[0]}，模型厂商重新争夺开发者入口，推理产品开始直接改写团队工作流。${markers[0]}也说明平台想把分发权抓回自己手里。`,
          `${markers[1]}最先落在算力采购和推理成本上，基础设施提供商因此重新获得议价权。${markers[1]}进一步放大了价格战的连锁反应。`,
          `${markers[2]}体现在开源模型与闭源 API 的产品路线分化上，团队不得不在速度与控制力之间重新选择。${markers[2]}已经从技术问题变成经营问题。`,
          `${markers[3]}不仅出现在融资节奏，也出现在招聘、合规和渠道扩张上。${markers[3]}会继续改变下周的市场判断。`,
          `${markers[0]}延续到媒体判断层面时，不同来源开始对谁能吃到下一轮红利出现分歧。`,
          `${markers[1]}如果持续上升，产业链位置会比单次发布热度更决定公司的战略空间。`,
          `${markers[2]}放在一起看，下周最值得追踪的仍是成本、渠道和生态绑定的联动。`,
        ]
      ),
    },
    researchPack: {
      sources: [
        { source_type: 'official_blog' },
        { source_type: 'independent_blog' },
        { source_type: 'paper' },
        { source_type: 'industry_media' },
        { source_type: 'industry_media' },
        { source_type: 'industry_media' },
        { source_type: 'industry_media' },
        { source_type: 'industry_media' },
      ],
    },
    formatProfile: weeklyProfile,
    config: {
      quality_gate: {
        weekly_review: {
          min_sources: 8,
          min_high_quality_sources: 3,
          high_quality_source_types: ['official_blog', 'independent_blog', 'paper'],
          min_chars: 50,
          max_banned_phrase_hits: 0,
          min_analysis_signals: 8,
        },
      },
    },
  })

  assert.equal(result.passed, true)
  assert.ok(result.metrics.analysis_signal_count >= 8)
})

test('quality gate rejects thin sections and insufficient paragraphs', () => {
  const result = evaluateQualityGate({
    post: {
      content_md: buildArticle(formatProfile, [
        '短段。[S1]',
        '只有一段虽然带有来源，但没有展开足够论证。[S2]',
        '这段也很短。[S3]',
        '历史脉络不足。[S1]',
        '判断不足。[S2]',
      ]),
    },
    researchPack: {
      sources: [
        { source_id: 'S1', source_type: 'official_blog', url: 'https://openai.com/a' },
        { source_id: 'S2', source_type: 'independent_blog', url: 'https://example.com/b' },
        { source_id: 'S3', source_type: 'paper', url: 'https://arxiv.org/abs/1' },
      ],
    },
    formatProfile,
    config: {
      quality_gate: {
        min_sources: 3,
        min_high_quality_sources: 2,
        high_quality_source_types: ['official_blog', 'independent_blog', 'paper'],
        min_chars: 10,
        min_section_chars: 80,
        min_section_paragraphs: 2,
        max_banned_phrase_hits: 1,
        min_analysis_signals: 0,
      },
    },
  })

  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.startsWith('thin_sections:')))
  assert.ok(result.reasons.some((reason) => reason.startsWith('section_paragraphs:')))
})

test('quality gate rejects missing subheadings, weak analysis distribution and source mentions', () => {
  const body = buildArticle(formatProfile, [
    'OpenAI Blog 给出了事实背景。[S1]\n\n这件事意味着入口竞争出现变化，影响会先落到开发团队。',
    '独立博客补充了外部视角。[S2]\n\n这里继续分析成本和取舍，但没有新的小标题。',
    '论文材料说明历史脉络。[S3]\n\n这里讨论不确定性和二阶后果。',
    '行业媒体提供补充事实。[S2]\n\n这里给出历史对照。',
    '最后判断仍然围绕开发者入口。[S1]\n\n如果这个判断错了，可能错在用户迁移速度。',
  ])
  const result = evaluateQualityGate({
    post: { content_md: body },
    researchPack: {
      evidence_cards: [{ id: 'E1' }],
      sources: [
        { source_id: 'S1', source_type: 'official_blog', source_name: 'OpenAI Blog', title: 'OpenAI update', url: 'https://openai.com/a' },
        { source_id: 'S2', source_type: 'independent_blog', source_name: 'Independent AI Notes', title: 'Developer view', url: 'https://example.com/b' },
        { source_id: 'S3', source_type: 'paper', source_name: 'arXiv', title: 'Agent paper', url: 'https://arxiv.org/abs/1' },
      ],
    },
    formatProfile,
    config: {
      quality_gate: {
        min_sources: 3,
        min_high_quality_sources: 2,
        high_quality_source_types: ['official_blog', 'independent_blog', 'paper'],
        min_chars: 10,
        max_banned_phrase_hits: 1,
        min_analysis_signals: 3,
        min_analysis_sections: 3,
        min_subheadings: 2,
        min_body_source_mentions: 5,
        min_evidence_cards: 2,
      },
    },
  })

  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.startsWith('subheadings:')))
  assert.ok(result.reasons.some((reason) => reason.startsWith('body_source_mentions:')))
  assert.ok(result.reasons.some((reason) => reason.startsWith('evidence_cards:')))
  assert.equal(result.metrics.subheading_count, 0)
})
