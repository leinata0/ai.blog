import { afterEach, expect, it, vi } from 'vitest'

import { formatDate, formatDateTime, formatTime, parseDate, timeAgo, toDateKey } from '../src/utils/date'

afterEach(() => {
  vi.unstubAllEnvs()
})

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

it('renders a date-only value as the day it names, in every timezone', () => {
  // parseDate anchors "2026-07-26" at UTC midnight. Formatting that in the viewer's zone
  // would roll it back a day everywhere west of Greenwich, so date-only values are pinned
  // to UTC — coverage_date / 归档 dateKey are calendar days, not instants.
  for (const zone of ['UTC', 'Asia/Shanghai', 'America/New_York', 'Pacific/Kiritimati']) {
    vi.stubEnv('TZ', zone)
    expect(formatDate('2026-07-26'), zone).toBe('2026/07/26')
    expect(formatDate('2026-07-26', { month: '2-digit', day: '2-digit' }), zone).toBe('07/26')
    expect(toDateKey('2026-07-26'), zone).toBe('2026-07-26')
  }
})

it('renders a real timestamp in the viewer’s timezone', () => {
  vi.stubEnv('TZ', 'Asia/Shanghai')
  expect(formatDate('2026-07-25T23:30:00+00:00')).toBe('2026/07/26')
  expect(formatDate('2026-07-25T23:30:00')).toBe('2026/07/26')
  expect(formatDateTime('2026-07-25T23:30:00Z', { hour12: false })).toBe('2026/7/26 07:30:00')
  expect(formatTime('2026-07-25T23:30:00Z')).toBe('07:30:00')

  vi.stubEnv('TZ', 'America/New_York')
  expect(formatDate('2026-07-25T23:30:00Z')).toBe('2026/07/25')
  expect(formatTime('2026-07-25T23:30:00Z')).toBe('19:30:00')
})

it('groups by the viewer’s calendar day, not the UTC one', () => {
  vi.stubEnv('TZ', 'Asia/Shanghai')
  expect(toDateKey('2026-07-25T23:30:00+00:00')).toBe('2026-07-26')
  expect(toDateKey('2026-07-25T23:30:00')).toBe('2026-07-26')
  expect(toDateKey('2025-12-31T23:30:00Z')).toBe('2026-01-01')

  vi.stubEnv('TZ', 'America/New_York')
  expect(toDateKey('2026-07-26T01:30:00Z')).toBe('2026-07-25')
  expect(toDateKey('')).toBe('')
  expect(toDateKey('not a date')).toBe('')
})

it('returns empty output from the datetime formatters for unusable input', () => {
  expect(formatDateTime('')).toBe('')
  expect(formatDateTime('not a date')).toBe('')
  expect(formatTime(null)).toBe('')
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
