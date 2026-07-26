// Canonical host for the whole site. The backend (RSS / sitemap) resolves it from
// settings.site_url, the build-time prerender from PUBLIC_SITE_URL — this constant is
// the single front-end fallback so a missing env var can never downgrade canonical
// URLs to an apex or Vercel preview host.
export const SITE_CANONICAL_ORIGIN = 'https://www.563118077.xyz'

export const SITE_COPY = {
  brand: 'AI 资讯观察',
  homeBadge: 'AI INTELLIGENCE DESK · 中文信号站',
  homeTitle: '从每天的噪音里，校准真正重要的 AI 信号',
  homeSubtitle:
    '连接模型、产品、研究与产业动作，把孤立新闻整理成可以持续追踪的变化脉络。',
  homeFocusLines: [
    '识别今天最重要的模型与产品变化',
    '连接论文、产品与产业动作',
    '将孤立新闻组织成长期主题网络',
    '用日报与周报保留连续上下文',
  ],
  homeSignalLabels: ['实时信号', '主题网络', '编辑筛选', '上下文追踪'],
  homePosterAlt: '站点 Hero 主海报',
  homeSearchPlaceholder: '输入模型、公司、产品或主题…',
  homeSearchAction: '校准信号',
  homeClearAction: '清空',
}

const HOME_TAGLINE = '持续更新 AI 最新动态与关键变化的中文博客'

// SEO copy shared by index.html, the build-time prerender (frontend/scripts/prerender-public.mjs)
// and runtime <SeoMeta>. Three hand-written variants used to disagree, so the crawler
// executed JS and ended up with a shorter title than the prerendered one. Add new SEO
// strings here instead of inlining them per surface.
export const SITE_SEO = {
  canonicalOrigin: SITE_CANONICAL_ORIGIN,
  brand: SITE_COPY.brand,
  homeTagline: HOME_TAGLINE,
  homeTitle: `${SITE_COPY.brand} | ${HOME_TAGLINE}`,
  homeDescription:
    '聚焦值得持续追踪的消息、产品更新与产业线索，用更清晰的结构整理每一天和每一周的重要变化。',
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
    // 固定色 #1d4ed8 配这块半透明蓝底，在暗色画布上只有 2.6:1；令牌在明暗两套画布下都达 AA。
    accent: 'var(--highlight-text)',
    background: 'var(--highlight-soft)',
    description: '从一周视角梳理关键变化，帮助你快速回看主线与趋势。',
    kicker: '每周回看',
  },
}

export const motionContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
}

export const motionItemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.36,
      ease: [0.16, 1, 0.3, 1],
    },
  },
}

export const hoverLift = {
  y: -4,
  transition: {
    duration: 0.2,
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
