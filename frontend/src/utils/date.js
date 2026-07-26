// 后端历史上返回过不带时区标记的 naive 时间串（"2026-04-14T08:00:00"），
// new Date() 会把它按浏览器本地时区解析，在 UTC+8 会整整早 8 小时。
// 这里统一：没有时区标记的按 UTC 解析，带 Z / ±HH:MM 的照常，两代后端都正确。
//
// 这是全站唯一的时间解析入口 —— 页面/面板不要再自己写 `new Date(value)`，
// 否则同一个字段在不同页面会差 8 小时（账号中心 / 关注 / 归档 / 后台面板都出过）。
const NAIVE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

const DEFAULT_DATE_OPTIONS = { year: 'numeric', month: '2-digit', day: '2-digit' }

export function isDateOnly(value) {
  return typeof value === 'string' && NAIVE_DATE_ONLY.test(value.trim())
}

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

// A date-only value ("2026-07-26", coverage_date / 归档 dateKey) is a calendar day, not an
// instant: parseDate anchors it at UTC midnight, so rendering it in the *viewer's* zone would
// roll it back a day everywhere west of Greenwich. Pin those to UTC; render real timestamps
// in local time, which is what "这篇文章什么时候发的" actually means to a reader.
function withZone(value, options) {
  return isDateOnly(value) ? { ...options, timeZone: 'UTC' } : options
}

export function formatDate(dateStr, options) {
  const d = parseDate(dateStr)
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', withZone(dateStr, options || DEFAULT_DATE_OPTIONS))
}

export function formatDateTime(dateStr, options) {
  const d = parseDate(dateStr)
  if (!d) return ''
  return d.toLocaleString('zh-CN', withZone(dateStr, options))
}

export function formatTime(dateStr, options) {
  const d = parseDate(dateStr)
  if (!d) return ''
  return d.toLocaleTimeString('zh-CN', withZone(dateStr, options))
}

// "YYYY-MM-DD" in the *viewer's* calendar, for day/year grouping (归档). A post published
// 2026-07-25T23:30:00Z belongs to 7月26日 for a UTC+8 reader, so slicing the ISO string
// (which is UTC) put it in the wrong bucket. Date-only input is already a calendar day and
// passes through untouched.
export function toDateKey(value) {
  if (isDateOnly(value)) return String(value).trim()
  const d = parseDate(value)
  if (!d) return ''
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
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
