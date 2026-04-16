export const SITE_COPY = {
  brand: 'AI 资讯观察',
  homeBadge: '中文 AI 资讯与观察',
  homeTitle: '持续更新 AI 最新动态与关键变化的中文博客',
  homeSubtitle:
    '聚焦值得持续追踪的消息、产品更新与产业线索，用更清晰的结构整理每一天和每一周的重要变化。',
  homeFocusLines: [
    '追踪今天最重要的 AI 变化',
    '连接产品更新与产业信号',
    '从噪音里筛出真正值得看的内容',
    '用日报与周报保留连续上下文',
  ],
  homeSignalLabels: ['日报', '周报', '主题追踪', '系列阅读'],
  homePosterAlt: '站点主海报',
  homeSearchPlaceholder: '搜索文章、主题或系列',
  homeSearchAction: '开始搜索',
  homeClearAction: '清空',
}

const SERIES_TITLES = {
  'ai-daily-brief': 'AI 日报',
  'ai-weekly-review': 'AI 周报',
  'product-strategy-watch': '产品战略观察',
  'paper-to-product': '论文到产品',
  'tooling-workflow': '工具与工作流',
}

const SERIES_DESCRIPTIONS = {
  'ai-daily-brief': '围绕当天最值得跟进的 AI 信号，快速建立信息框架与后续追踪入口。',
  'ai-weekly-review': '把一周的重要变化串成完整脉络，帮助你从单点消息回到长期趋势。',
  'product-strategy-watch': '关注 AI 公司、产品和平台的动作，理解它们背后的战略走向。',
  'paper-to-product': '从论文、研究和方法论出发，观察它们如何走向真实产品与应用。',
  'tooling-workflow': '整理对开发者和团队真正有用的工具、流程和自动化实践。',
}

export const CONTENT_TYPE_META = {
  daily_brief: {
    key: 'daily_brief',
    label: '日报',
    title: 'AI 日报',
    englishTitle: 'AI Daily Brief',
    accent: 'var(--accent)',
    background: 'var(--accent-soft)',
    description: '聚焦当天最值得跟进的 AI 消息、产品更新与产业线索。',
    kicker: '每日更新',
  },
  weekly_review: {
    key: 'weekly_review',
    label: '周报',
    title: 'AI 周报',
    englishTitle: 'AI Weekly Review',
    accent: '#2563eb',
    background: 'rgba(37, 99, 235, 0.12)',
    description: '从一周视角梳理关键变化，帮助你快速回看主线与趋势。',
    kicker: '每周回看',
  },
}

export const motionContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.05,
    },
  },
}

export const motionItemVariants = {
  hidden: { opacity: 0, y: 22 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.16, 1, 0.3, 1],
    },
  },
}

export const hoverLift = {
  y: -6,
  transition: {
    duration: 0.24,
    ease: [0.16, 1, 0.3, 1],
  },
}

function toDisplayText(value, fallback = '') {
  return String(value || fallback).trim()
}

function toTitleCase(slug = '') {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export function getContentTypeMeta(contentType) {
  return CONTENT_TYPE_META[contentType] || null
}

export function getContentTypeLabel(contentType) {
  return getContentTypeMeta(contentType)?.label || '文章'
}

export function getTopicTitle(topic) {
  return toDisplayText(
    topic?.display_title ||
      topic?.title ||
      topic?.profile?.display_title ||
      topic?.profile?.title ||
      topic?.topic_key,
    '未命名主题',
  )
}

export function getSeriesTitle(series) {
  const slug = toDisplayText(series?.slug)
  return SERIES_TITLES[slug] || toDisplayText(series?.title, toTitleCase(slug) || '未命名系列')
}

export function getTopicDescription(topic) {
  return toDisplayText(
    topic?.description,
    '围绕同一条主线持续聚合日报、周报与延伸解读，帮助你从单点消息回到长期变化。',
  )
}

export function getSeriesDescription(series) {
  const slug = toDisplayText(series?.slug)
  return SERIES_DESCRIPTIONS[slug] || toDisplayText(
    series?.description,
    '把分散内容整理成一条更容易持续阅读的栏目路径。',
  )
}

export function getTopicBadgeLabel(topic) {
  return topic?.is_featured ? '编辑推荐' : '持续追踪'
}

export function getTopicEyebrow(topic) {
  return topic?.is_featured ? '推荐主题' : '主题主线'
}

export function getSeriesEyebrow() {
  return '内容系列'
}

export function getRelativeDateLabel(value, fallback = '') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback || String(value)
  return date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}
