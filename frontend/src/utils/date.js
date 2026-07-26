// 后端历史上返回过不带时区标记的 naive 时间串（"2026-04-14T08:00:00"），
// new Date() 会把它按浏览器本地时区解析，在 UTC+8 会整整早 8 小时。
// 这里统一：没有时区标记的按 UTC 解析，带 Z / ±HH:MM 的照常，两代后端都正确。
const NAIVE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  const text = String(value).trim()
  if (!text) return null

  let normalized = text
  if (NAIVE_DATE_ONLY.test(text)) {
    normalized = `${text}T00:00:00Z`
  } else if (NAIVE_DATETIME.test(text)) {
    normalized = `${text.replace(' ', 'T')}Z`
  }

  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatDate(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function timeAgo(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return ''
  const now = Date.now()
  const past = d.getTime()
  const diff = Math.floor((now - past) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`
  return formatDate(dateStr)
}
