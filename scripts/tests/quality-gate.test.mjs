import test from 'node:test'
import assert from 'node:assert/strict'

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

test('quality gate passes for a sufficiently structured post', () => {
  const result = evaluateQualityGate({
    post: {
      content_md: [
        '## 一、发生了什么',
        '这件事意味着工程实践发生变化。',
        '## 二、为什么这件事值得关注',
        '问题在于成本和速度同时被改写。',
        '## 三、不同来源怎么看',
        '官方和独立博客给出了不同的取舍。',
        '## 四、如果结合论文/历史脉络，该怎么理解',
        '论文与产品落地之间有明显距离。',
        '## 五、我的判断',
        '更关键的是落地代价。',
        '## 参考来源',
        '- a',
        '## 图片来源',
        '- b',
        '## 一句话结论',
        '长期影响大于短期热度。',
      ].join('\n\n'),
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

test('quality gate rejects post with missing sections', () => {
  const result = evaluateQualityGate({
    post: { content_md: '## 一、发生了什么\n\n让我们拭目以待。' },
    researchPack: { sources: [{ source_type: 'industry_media' }] },
    formatProfile,
    config,
  })

  assert.equal(result.passed, false)
  assert.ok(result.reasons.some((reason) => reason.startsWith('missing_sections:')))
})
