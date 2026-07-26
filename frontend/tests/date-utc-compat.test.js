import { expect, it, vi } from 'vitest'

import { formatDate, parseDate, timeAgo } from '../src/utils/date'

it('treats a timezone-less datetime as UTC, not as browser-local time', () => {
  // 后端历史上返回 naive 串；new Date() 会按本地时区解析，在 UTC+8 会整整差 8 小时。
  expect(parseDate('2026-04-14T08:00:00').getTime()).toBe(Date.parse('2026-04-14T08:00:00Z'))
  expect(parseDate('2026-04-14 08:00:00').getTime()).toBe(Date.parse('2026-04-14T08:00:00Z'))
  expect(parseDate('2026-04-14T08:00').getTime()).toBe(Date.parse('2026-04-14T08:00:00Z'))
  expect(parseDate('2026-04-14T08:00:00.5').getTime()).toBe(Date.parse('2026-04-14T08:00:00.5Z'))
})

it('leaves explicitly zoned timestamps alone', () => {
  expect(parseDate('2026-04-14T08:00:00Z').getTime()).toBe(Date.parse('2026-04-14T08:00:00Z'))
  expect(parseDate('2026-04-14T08:00:00+08:00').getTime()).toBe(Date.parse('2026-04-14T08:00:00+08:00'))
  expect(parseDate('2026-04-14T08:00:00-05:00').getTime()).toBe(Date.parse('2026-04-14T08:00:00-05:00'))
})

it('parses date-only values at UTC midnight', () => {
  expect(parseDate('2026-04-14').getTime()).toBe(Date.parse('2026-04-14T00:00:00Z'))
})

it('returns null / empty output for unusable input', () => {
  expect(parseDate('')).toBeNull()
  expect(parseDate(null)).toBeNull()
  expect(parseDate('not a date')).toBeNull()
  expect(formatDate('')).toBe('')
  expect(formatDate('not a date')).toBe('')
  expect(timeAgo('')).toBe('')
})

it('measures relative time from the UTC-normalized instant', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-04-14T09:00:00Z'))
    // Naive string 30 minutes before "now" — with local parsing this would read as hours off.
    expect(timeAgo('2026-04-14T08:30:00')).toBe('30 分钟前')
    expect(timeAgo('2026-04-14T08:30:00Z')).toBe('30 分钟前')
    expect(timeAgo('2026-04-14T06:00:00')).toBe('3 小时前')
  } finally {
    vi.useRealTimers()
  }
})
