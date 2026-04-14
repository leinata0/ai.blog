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

test('quality gate resolves nested daily brief rules from content type', () => {
  const result = evaluateQualityGate({
    post: {
      content_type: 'daily_brief',
      gate_profile: 'daily_brief',
      content_md: [
        '## 一、发生了什么',
        'OpenAI 发布了新的开发者代理能力，并同步开放 API 接入。',
        '这意味着同一套能力开始从演示阶段走向真实工作流。',
        '## 二、为什么这件事值得关注',
        '官方和行业媒体都把重点放在开发效率与可靠性变化上。',
        '更关键的是，这类产品开始直接竞争 IDE 和工作流入口。',
        '## 三、不同来源怎么看',
        '官方博客强调产品集成速度，行业媒体则更关注价格与团队替代边界。',
        '换句话说，同一件事在不同来源眼里分别对应增长机会与组织代价。',
        '### 技术媒体的观察',
        '技术媒体认为问题在于真实团队是否愿意把高风险执行权限交给代理。',
        '## 四、如果结合论文/历史脉络，该怎么理解',
        '如果拉长来看，这和过去代码补全工具的扩张路径一致，只是这次更强调代理式执行。',
        '问题在于，论文里的规划能力要落到真实工程环境，依然要补很多工具链细节。',
        '### 历史脉络里的重复模式',
        '每一轮工具升级都会先在低风险任务打开缺口，再向高价值流程扩张。',
        '## 五、我的判断',
        '我更看重它对团队工作分工的影响，而不只是单点提效。',
        '真正值得注意的是，未来的竞争会从模型参数转向谁能占住开发入口。',
        '## 参考来源',
        '- a',
        '## 图片来源',
        '- 无正文插图',
      ].join('\n\n'),
    },
    researchPack: {
      sources: [
        { source_type: 'official_blog' },
        { source_type: 'industry_media' },
      ],
    },
    formatProfile: createDailyBriefFormatProfile(),
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
