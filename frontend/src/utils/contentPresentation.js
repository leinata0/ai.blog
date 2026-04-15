export const CONTENT_TYPE_META = {
  daily_brief: {
    label: '日报',
    accent: 'var(--accent)',
    background: 'var(--accent-soft)',
  },
  weekly_review: {
    label: '周报',
    accent: '#2563eb',
    background: 'rgba(37, 99, 235, 0.12)',
  },
}

export const motionContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.04,
    },
  },
}

export const motionItemVariants = {
  hidden: { opacity: 0, y: 22 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: [0.16, 1, 0.3, 1],
    },
  },
}

export const hoverLift = {
  y: -6,
  transition: { duration: 0.22, ease: 'easeOut' },
}

export function getContentTypeLabel(contentType) {
  return CONTENT_TYPE_META[contentType]?.label || '文章'
}

export function getTopicTitle(topic) {
  return String(
    topic?.display_title ||
      topic?.title ||
      topic?.profile?.display_title ||
      topic?.profile?.title ||
      topic?.topic_key ||
      '未命名主题',
  ).trim()
}

export function getSeriesTitle(series) {
  return String(series?.title || series?.slug || '未命名系列').trim()
}

export function getTopicDescription(topic) {
  return String(topic?.description || '围绕同一条新闻主线持续聚合日报、周报与延伸解读。').trim()
}

export function getSeriesDescription(series) {
  return String(series?.description || '把分散内容组织为长期可追踪的编辑栏目。').trim()
}

export function getTopicBadgeLabel(topic) {
  return topic?.is_featured ? '编辑推荐' : '持续追踪'
}
