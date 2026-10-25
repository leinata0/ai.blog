/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { createPublicHomeSnapshot, PUBLIC_HOME_SNAPSHOT_MAX_BYTES, serializePublicHomeSnapshot } from '../src/utils/publicHomeSnapshot.js'

const generatedAt = '2026-10-25T12:00:00.123Z'
const post = (overrides = {}) => ({ slug: 'headline', title: 'Headline', content_type: 'daily_brief', source_count: 6, ...overrides })
const rawHome = () => ({
  settings: { author_name: 'Observer', site_url: 'https://www.563118077.xyz' },
  posts: { items: [post()], total: 141, page: 1, page_size: 10 },
  home_modules: { latest_weekly: [post({ slug: 'weekly', content_type: 'weekly_review' })], featured_series: [{ slug: 'models', title: 'Models', post_count: 4 }] },
  home_topics: [{ topic_key: 'ai', display_title: 'AI', post_count: 10, source_count: 9 }],
})

describe('complete public home snapshot schema', () => {
  it('preserves the public page contract and original timestamp without mutating source data', () => {
    const raw = rawHome()
    const before = JSON.stringify(raw)
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    expect(snapshot).toMatchObject({ schemaVersion: 1, route: '/', generatedAt, posts: { total: 141, page: 1, page_size: 10 } })
    expect(snapshot.home_modules.latest_weekly[0].slug).toBe('weekly')
    expect(snapshot.home_topics[0]).toMatchObject({ topic_key: 'ai', source_count: 9 })
    expect(JSON.stringify(raw)).toBe(before)
    expect(createPublicHomeSnapshot(snapshot).generatedAt).toBe(generatedAt)
  })

  it('keeps editorial order, pinned identity, object tags and source counts', () => {
    const raw = rawHome()
    raw.posts.items = [post({ slug: 'older-pinned', is_pinned: true, created_at: '2026-01-01', tags: [{ name: '模型', slug: 'models', admin_note: 'secret' }] }), post({ slug: 'newer', created_at: '2026-10-25' })]
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    expect(snapshot.posts.items.map((item) => item.slug)).toEqual(['older-pinned', 'newer'])
    expect(snapshot.posts.items[0]).toMatchObject({ is_pinned: true, source_count: 6, tags: [{ name: '模型', slug: 'models' }] })
    expect(snapshot.posts.items[1].is_pinned).toBe(false)
  })

  it('caps all four sections and tags while retaining exact total', () => {
    const raw = rawHome()
    raw.posts.items = Array.from({ length: 15 }, (_, index) => post({ slug: `p${index}`, tags: Array.from({ length: 12 }, (_, tag) => ({ name: `Tag ${tag}`, slug: `tag-${tag}` })) }))
    raw.posts.total = 1024
    raw.home_modules.latest_weekly = Array.from({ length: 7 }, (_, index) => post({ slug: `w${index}`, content_type: 'weekly_review' }))
    raw.home_modules.featured_series = Array.from({ length: 7 }, (_, index) => ({ slug: `s${index}`, title: 'Series' }))
    raw.home_topics = Array.from({ length: 9 }, (_, index) => ({ topic_key: `t${index}` }))
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    expect(snapshot.posts.items).toHaveLength(10)
    expect(snapshot.posts.items[0].tags).toHaveLength(8)
    expect(snapshot.posts.total).toBe(1024)
    expect(snapshot.home_modules.latest_weekly).toHaveLength(3)
    expect(snapshot.home_modules.featured_series).toHaveLength(2)
    expect(snapshot.home_topics).toHaveLength(4)
  })

  it('uses only the eight public settings and public summary fields', () => {
    const raw = rawHome()
    raw.settings = { ...raw.settings, api_token: 'provider-secret', admin_email: 'private@example.test' }
    raw.posts.items[0] = post({ content_md: 'full-private-body', author_email: 'private@example.test', sources: [{ api_key: 'source-secret' }] })
    raw.home_modules.continue_reading = { items: [{ title: 'private-history' }] }
    raw.home_modules.featured_series[0].internal_note = 'series-secret'
    raw.home_topics[0].profile = { private_note: 'topic-secret' }
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    expect(Object.keys(snapshot.settings)).toEqual(['author_name', 'bio', 'avatar_url', 'hero_image', 'github_link', 'announcement', 'site_url', 'friend_links'])
    expect(Object.keys(snapshot.home_modules)).toEqual(['latest_weekly', 'featured_series'])
    expect(JSON.stringify(snapshot)).not.toMatch(/provider-secret|private@example|full-private-body|source-secret|private-history|series-secret|topic-secret/)
  })

  it('accepts actual empty source arrays without substituting old content', () => {
    const snapshot = createPublicHomeSnapshot({ settings: {}, posts: { items: [], total: 0 }, home_modules: { latest_weekly: [], featured_series: [] }, home_topics: [] }, generatedAt)
    expect(snapshot.posts).toEqual({ items: [], total: 0, page: 1, page_size: 10 })
    expect(snapshot.home_modules).toEqual({ latest_weekly: [], featured_series: [] })
    expect(snapshot.home_topics).toEqual([])
    expect(serializePublicHomeSnapshot(snapshot)).toBeTruthy()
  })

  it.each([
    ['settings', null], ['settings', []], ['posts', null], ['posts', {}],
    ['home_modules', null], ['home_modules', {}], ['home_topics', null], ['home_topics', {}],
  ])('rejects a missing or malformed %s instead of returning an empty section', (key, value) => {
    expect(createPublicHomeSnapshot({ ...rawHome(), [key]: value }, generatedAt)).toBeNull()
  })

  it.each(['settings', 'posts', 'home_modules', 'home_topics'])('requires the %s source section', (key) => {
    const raw = rawHome()
    delete raw[key]
    expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
  })

  it.each([undefined, -1, '141', Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact totals %s', (total) => {
    const raw = rawHome()
    raw.posts.total = total
    expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
  })

  it.each([
    { items: null }, { page: 2 }, { page_size: 50 },
    { items: [null] }, { items: [post({ is_published: false })] },
    { items: [post({ status: 'draft' })] }, { items: [post({ tags: {} })] },
  ])('rejects malformed/unpublished post sources %j', (changes) => {
    const raw = rawHome()
    Object.assign(raw.posts, changes)
    expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
  })

  it('requires both supplementary source arrays and rejects malformed rows', () => {
    for (const [field, value] of [['latest_weekly', null], ['featured_series', null], ['latest_weekly', [post()]], ['featured_series', [{}]]]) {
      const raw = rawHome()
      raw.home_modules[field] = value
      expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
    }
    const raw = rawHome()
    raw.home_topics = [null]
    expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
  })

  it('rejects malformed settings and timestamps', () => {
    const raw = rawHome()
    raw.settings.hero_image = { unsafe: true }
    expect(createPublicHomeSnapshot(raw, generatedAt)).toBeNull()
    expect(createPublicHomeSnapshot(rawHome(), 'not a date')).toBeNull()
    expect(createPublicHomeSnapshot(rawHome(), null)).toBeNull()
  })

  it('serializes HTML-safe JSON and strips extra fields again at the serialization boundary', () => {
    const raw = rawHome()
    raw.posts.items[0].title = '</script><script>alert(1)</script>\u2028\u2029'
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    snapshot.secret = 'not-public'
    const serialized = serializePublicHomeSnapshot(snapshot)
    expect(serialized).not.toMatch(/<|>|\u2028|\u2029|not-public/)
    expect(JSON.parse(serialized).posts.items[0].title).toBe(raw.posts.items[0].title)
    expect(JSON.parse(serialized).generatedAt).toBe(generatedAt)
  })

  it('enforces the 128 KiB UTF-8 limit after HTML escaping', () => {
    const raw = rawHome()
    raw.posts.items = Array.from({ length: 10 }, (_, index) => post({ slug: `p${index}`, summary: '<'.repeat(1200), cover_image: '图'.repeat(2048) }))
    const snapshot = createPublicHomeSnapshot(raw, generatedAt)
    expect(PUBLIC_HOME_SNAPSHOT_MAX_BYTES).toBe(128 * 1024)
    expect(serializePublicHomeSnapshot(snapshot)).toBe('')
  })

  it('does not serialize a wrong route or schema version', () => {
    const snapshot = createPublicHomeSnapshot(rawHome(), generatedAt)
    expect(serializePublicHomeSnapshot({ ...snapshot, route: '/daily' })).toBe('')
    expect(serializePublicHomeSnapshot({ ...snapshot, schemaVersion: 2 })).toBe('')
    expect(serializePublicHomeSnapshot(null)).toBe('')
  })
})
