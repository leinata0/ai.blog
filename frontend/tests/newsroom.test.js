import { expect, it } from 'vitest'
import { buildNewsroomSections, NEWS_BEATS } from '../src/utils/newsroom'

const article = (slug, extra = {}) => ({ slug, title: `标题 ${slug}`, ...extra })
const weekly = (slug, extra = {}) => article(slug, { content_type: 'weekly_review', ...extra })
const slugs = (posts) => posts.map((post) => post.slug)

it('preserves the API order of lead stories, stream and weekly reading', () => {
  const posts = [article('pinned'), article('b'), article('c'), weekly('overlap'), article('d'), article('e')]
  const modules = { latest_weekly: [weekly('overlap'), weekly('module-only'), weekly('extra')] }
  const result = buildNewsroomSections(posts, modules)
  expect(slugs(result.focus)).toEqual(['pinned', 'b', 'c'])
  expect(slugs(result.deepReads)).toEqual(['overlap', 'module-only'])
  expect(slugs(result.stream)).toEqual(['d', 'e'])
})

it('deduplicates slugs across every section without moving a lead story to deep reading', () => {
  const result = buildNewsroomSections(
    [weekly('a'), article('a'), article('b'), article('c'), article('d'), article('d'), article('e')],
    { latest_weekly: [weekly('a'), weekly('d'), weekly('d'), weekly('f')] },
  )
  expect(slugs(result.focus)).toEqual(['a', 'b', 'c'])
  expect(slugs(result.deepReads)).toEqual(['d', 'f'])
  expect(slugs(result.stream)).toEqual(['e'])
  const allSlugs = slugs([...result.focus, ...result.stream, ...result.deepReads])
  expect(new Set(allSlugs).size).toBe(allSlugs.length)
})

it('does not fill deep reading with non-weekly content or append unused module content to the stream', () => {
  const result = buildNewsroomSections(
    ['a', 'b', 'c', 'd'].map((slug) => article(slug)),
    { latest_weekly: [article('news'), article('w1'), weekly('w1'), weekly('w2'), weekly('w3')], latest_daily: [article('daily')] },
  )
  expect(slugs(result.deepReads)).toEqual(['w1', 'w2'])
  expect(slugs(result.stream)).toEqual(['d'])
})

it('omits invalid article fields, trims identifiers and keeps the first valid duplicate', () => {
  const invalid = [null, {}, { slug: 'x' }, { title: 'x' }, article(' '), article('x', { title: ' ' }), article(5)]
  const first = article(' a ', { title: '  首条  ' })
  const result = buildNewsroomSections(
    [...invalid, first, article('a'), article('b')],
    { latest_weekly: [...invalid, weekly('w', { title: '' }), weekly('valid')] },
  )
  expect(result.focus).toEqual([{ ...first, slug: 'a', title: '首条' }, article('b')])
  expect(slugs(result.deepReads)).toEqual(['valid'])
  expect(result.stream).toEqual([])
  expect(first.slug).toBe(' a ')
})

it('supports short feeds, missing modules and malformed list values', () => {
  expect(buildNewsroomSections()).toEqual({ focus: [], stream: [], deepReads: [] })
  expect(buildNewsroomSections(null, null)).toEqual({ focus: [], stream: [], deepReads: [] })
  expect(buildNewsroomSections([article('only')], { latest_weekly: {} })).toEqual({
    focus: [article('only')], stream: [], deepReads: [],
  })
})

it('exports five stable search navigation beats without classifying stories', () => {
  expect(NEWS_BEATS.map((beat) => beat.title)).toEqual(['模型与产品', '研究前沿', '开源与工具', '算力与产业', '治理与安全'])
  expect(new Set(NEWS_BEATS.map((beat) => beat.code)).size).toBe(5)
  expect(NEWS_BEATS.every((beat) => typeof beat.query === 'string' && beat.query.length > 0)).toBe(true)
  expect(Object.isFrozen(NEWS_BEATS)).toBe(true)
})
