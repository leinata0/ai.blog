export const CONTENT_TYPE_LABELS = {
  daily_brief: '日报',
  weekly_review: '周报',
  post: '文章',
}

export const PUBLISHED_MODE_LABELS = {
  auto: '自动',
  manual: '手动',
}

export const PUBLISHED_STATE_LABELS = {
  published: '已发布',
  draft: '草稿',
}

export const RUN_STATUS_LABELS = {
  success: '成功',
  failed: '失败',
  running: '运行中',
  skipped: '已跳过',
  candidate: '候选',
  published: '已发布',
  draft: '草稿',
}

export const VERDICT_LABELS = {
  excellent: '优秀',
  solid: '稳健',
  weak: '待加强',
}

export const RECOMMENDATION_LABELS = {
  expand: '建议扩展',
  maintain: '持续观察',
  improve: '优先优化',
}

const ISSUE_LABELS = {
  missing_sources: '来源不足',
  missing_sections: '结构缺章',
  analysis_thin: '分析偏浅',
  banned_phrase_hit: '命中套话',
  weak_title: '标题偏弱',
  weak_summary: '摘要偏弱',
  too_short_for_depth: '篇幅偏短',
  series_unassigned: '未归入系列',
  missing_cover_image: '缺少封面图',
  missing_series: '缺少系列归属',
  missing_quality_score: '缺少质量分',
  missing_reading_time: '缺少阅读时长',
  draft: '仍为草稿',
}

const STRENGTH_LABELS = {
  strong_source_mix: '来源组合扎实',
  complete_structure: '结构完整',
  analysis_depth_good: '分析深度良好',
  title_clarity_good: '标题清晰',
  sufficient_depth: '篇幅充足',
}

function fallbackLabel(value, emptyLabel) {
  if (!value) return emptyLabel
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function getContentTypeLabel(value) {
  return CONTENT_TYPE_LABELS[value] || fallbackLabel(value, '文章')
}

export function getPublishedModeLabel(value) {
  return PUBLISHED_MODE_LABELS[value] || fallbackLabel(value, '未标记')
}

export function getPublishStateLabel(value) {
  return PUBLISHED_STATE_LABELS[value] || fallbackLabel(value, '未知状态')
}

export function getRunStatusLabel(value) {
  return RUN_STATUS_LABELS[value] || fallbackLabel(value, '未知状态')
}

export function getVerdictLabel(value) {
  return VERDICT_LABELS[value] || '未复盘'
}

export function getRecommendationLabel(value) {
  return RECOMMENDATION_LABELS[value] || '持续观察'
}

export function getQualityIssueLabel(value) {
  return ISSUE_LABELS[value] || fallbackLabel(value, '未标记问题')
}

export function getQualityStrengthLabel(value) {
  return STRENGTH_LABELS[value] || fallbackLabel(value, '优势待补充')
}

export function localizeAdminText(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text
    .replace(/^Published (\d+) posts?$/i, '已发布 $1 篇文章')
    .replace(/^duplicate topic_key detected$/i, '检测到重复 topic_key')
    .replace(/^topic already published$/i, '该主题已发布')
    .replace(/^missing sources$/i, '来源不足')
    .replace(/^quality snapshot generated after a passed gate\.$/i, '质量快照已在质量闸门通过后生成。')
    .replace(/^quality snapshot generated in degraded mode\.$/i, '质量快照已以降级模式生成。')
}

export function getScoreTone(score) {
  const numeric = Number(score)
  if (!Number.isFinite(numeric)) {
    return {
      text: 'text-[var(--text-secondary)]',
      chip: 'bg-[var(--bg-canvas)] text-[var(--text-secondary)]',
    }
  }
  if (numeric >= 85) {
    return {
      text: 'text-emerald-700',
      chip: 'bg-emerald-50 text-emerald-700',
    }
  }
  if (numeric >= 70) {
    return {
      text: 'text-sky-700',
      chip: 'bg-sky-50 text-sky-700',
    }
  }
  return {
    text: 'text-amber-700',
    chip: 'bg-amber-50 text-amber-700',
  }
}
