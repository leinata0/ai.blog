import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CROSS_DAY_DEDUPE_DEFAULTS,
  collectTopicSourceUrls,
  computeSourceOverlap,
  extractReferenceUrlsFromMarkdown,
  fetchPublishedTopicKeys,
  fetchRecentPublishedTopicFingerprints,
  findPublishedTopicOverlap,
  parseBriefSlug,
  resolveCrossDayDedupeConfig,
  resolvePublishedTopicGuards,
  selectTopicsForPublishing,
  shiftCoverageDate,
} from '../auto-blog.mjs'

// A cluster topic_key is a sha1 over the cluster's member URL set, so a story that keeps
// attracting coverage gets a brand-new key every day. Exact topic_key matching therefore
// cannot catch a day-2 rerun at ANY lookback width — the tests below pin the replacement
// judgement (source-URL overlap) instead.

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body }, async text() { return '' } }
}

function topic(topicKey, urls) {
  return {
    topic_key: topicKey,
    candidate_title: topicKey,
    source_count: urls.length,
    bucket_count: 2,
    non_official_source_count: 1,
    score: 5,
    latest_published_at: '2026-07-18T02:00:00Z',
    items: urls.map((url, index) => ({ url, title: `${topicKey}-${index}`, source_name: 'src' })),
  }
}

function fingerprint(slug, coverageDate, urls) {
  return { slug, coverage_date: coverageDate, topic_key: `${slug}-key`, source_urls: new Set(urls) }
}

function createLogger() {
  const warns = []
  const logs = []
  return { warns, logs, warn: (message) => warns.push(String(message)), log: (message) => logs.push(String(message)) }
}

const DEDUPE_RUNTIME = {
  maxPosts: 2,
  minSourcesPerTopic: 2,
  overlapThreshold: CROSS_DAY_DEDUPE_DEFAULTS.overlapThreshold,
  minSharedSources: CROSS_DAY_DEDUPE_DEFAULTS.minSharedSources,
}

// --- the core scenario: yesterday's story resurfaces with fresh follow-up coverage ---

test('a topic whose cluster reuses yesterday\'s sources is skipped even though its key is new', () => {
  const yesterday = fingerprint('ai-brief-2026-07-17-model-launch', '2026-07-17', [
    'https://openai.com/blog/launch',
    'https://techcrunch.com/launch',
    'https://theverge.com/launch',
  ])

  // Day 2: the two carried-over URLs plus five new follow-ups. Different member set →
  // different topic_key → the exact-match guard would wave this straight through.
  const candidate = topic('model-launch-9f2a41bc', [
    'https://openai.com/blog/launch',
    'https://techcrunch.com/launch',
    'https://wired.com/followup',
    'https://arstechnica.com/followup',
    'https://bloomberg.com/followup',
    'https://reuters.com/followup',
    'https://ft.com/followup',
  ])

  const result = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [yesterday],
  })

  assert.equal(result.queue.length, 0)
  assert.deepEqual(result.skipped_topic_keys, ['model-launch-9f2a41bc'])
  assert.equal(result.skipped_topics[0].topic_key, 'model-launch-9f2a41bc')
  assert.equal(result.skipped_topics[0].post_slug, 'ai-brief-2026-07-17-model-launch')
  assert.equal(result.skipped_topics[0].post_topic_key, 'ai-brief-2026-07-17-model-launch-key')
  assert.equal(result.skipped_topics[0].shared_source_count, 2)
  assert.match(result.skipped_topics[0].reason, /source overlap 67% with ai-brief-2026-07-17-model-launch \(2026-07-17\)/)
})

test('an unrelated new topic still publishes against the same published history', () => {
  const yesterday = fingerprint('ai-brief-2026-07-17-model-launch', '2026-07-17', [
    'https://openai.com/blog/launch',
    'https://techcrunch.com/launch',
    'https://theverge.com/launch',
  ])
  const candidate = topic('chip-supply-11aabb22', [
    'https://nvidia.com/newsroom/chips',
    'https://tomshardware.com/chips',
    'https://semianalysis.com/chips',
  ])

  const result = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [yesterday],
  })

  assert.deepEqual(result.queue.map((entry) => entry.topic_key), ['chip-supply-11aabb22'])
  assert.deepEqual(result.skipped_topics, [])
  assert.deepEqual(result.skipped_topic_keys, [])
})

// --- threshold boundary ---

test('overlap exactly at the threshold is skipped and just below it is published', () => {
  const published = fingerprint('ai-brief-2026-07-17-x', '2026-07-17', [
    'https://a.com/1', 'https://a.com/2', 'https://b.com/1', 'https://b.com/2',
  ])

  // shared 2 of min(4, 4) = 0.5 → exactly the 0.5 threshold, and >= wins.
  const atThreshold = topic('at-threshold', [
    'https://a.com/1', 'https://a.com/2', 'https://c.com/1', 'https://c.com/2',
  ])
  // A disjoint pair of sets one URL wider on both sides: shared 2 of min(5, 5) = 0.4.
  const widerPublished = fingerprint('ai-brief-2026-07-17-y', '2026-07-17', [
    'https://e.com/1', 'https://e.com/2', 'https://e.com/3', 'https://f.com/1', 'https://f.com/2',
  ])
  const belowThreshold = topic('below-threshold', [
    'https://e.com/1', 'https://e.com/2', 'https://g.com/1', 'https://g.com/2', 'https://g.com/3',
  ])

  assert.equal(
    computeSourceOverlap(collectTopicSourceUrls(atThreshold), published.source_urls).ratio,
    0.5,
  )
  assert.equal(
    computeSourceOverlap(collectTopicSourceUrls(belowThreshold), widerPublished.source_urls).ratio,
    0.4,
  )

  const result = selectTopicsForPublishing([atThreshold, belowThreshold], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [published, widerPublished],
  })

  assert.deepEqual(result.queue.map((entry) => entry.topic_key), ['below-threshold'])
  assert.deepEqual(result.skipped_topics.map((entry) => entry.topic_key), ['at-threshold'])
})

test('a single shared URL never trips the guard, however small the published source set', () => {
  // Overlap coefficient degenerates to 1.0 when the published post has one source; the
  // min-shared-sources floor is what keeps an incidental hit from blocking a real topic.
  const thin = fingerprint('ai-brief-2026-07-17-thin', '2026-07-17', ['https://a.com/1'])
  const candidate = topic('broad-topic', [
    'https://a.com/1', 'https://e.com/1', 'https://e.com/2', 'https://e.com/3',
  ])

  assert.equal(computeSourceOverlap(collectTopicSourceUrls(candidate), thin.source_urls).ratio, 1)

  const result = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [thin],
  })

  assert.deepEqual(result.queue.map((entry) => entry.topic_key), ['broad-topic'])
})

test('findPublishedTopicOverlap reports the strongest match and honours custom thresholds', () => {
  const candidate = topic('t', ['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://a.com/4'])
  const weak = fingerprint('weak', '2026-07-16', ['https://a.com/1', 'https://a.com/2', 'https://z.com/1', 'https://z.com/2'])
  const strong = fingerprint('strong', '2026-07-17', ['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://z.com/9'])

  const best = findPublishedTopicOverlap(candidate, [weak, strong], { overlapThreshold: 0.5, minSharedSources: 2 })
  assert.equal(best.post_slug, 'strong')
  assert.equal(best.overlap_ratio, 0.75)

  assert.equal(findPublishedTopicOverlap(candidate, [weak, strong], { overlapThreshold: 0.9, minSharedSources: 2 }), null)
  assert.equal(findPublishedTopicOverlap({ items: [] }, [strong], {}), null)
})

// --- URL normalisation carries over into the overlap check ---

test('tracking parameters and trailing slashes do not hide an overlap', () => {
  const published = fingerprint('p', '2026-07-17', [
    'https://openai.com/blog/launch',
    'https://techcrunch.com/launch',
    'https://theverge.com/launch',
  ])
  const candidate = topic('same-story', [
    'https://OpenAI.com/blog/launch/',
    'https://techcrunch.com/launch?utm_source=rss&utm_medium=feed',
    'https://newcomer.co/take',
  ])

  const result = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: new Set(),
    publishedTopicFingerprints: [published],
  })
  assert.equal(result.queue.length, 0)
})

// --- --force must bypass the new guard exactly like the old ones ---

test('--force bypasses the cross-day guard without issuing a single request', async () => {
  const guards = await resolvePublishedTopicGuards(
    { skipPublishedTopicKeys: true, force: true, dryRun: false, crossDayDedupe: resolveCrossDayDedupeConfig() },
    {
      coverageDate: '2026-07-18',
      fetchImpl: async () => { throw new Error('network must not be touched under --force') },
    },
  )

  assert.equal(guards.bypassed, true)
  assert.equal(guards.publishedTopicKeys.size, 0)
  assert.deepEqual(guards.publishedTopicFingerprints, [])

  // And an empty guard set means nothing is filtered out downstream.
  const candidate = topic('same-story', ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'])
  const result = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: guards.publishedTopicKeys,
    publishedTopicFingerprints: guards.publishedTopicFingerprints,
  })
  assert.equal(result.queue.length, 1)
})

test('dry runs and disabled dedupe also skip the lookup', async () => {
  const failingFetch = async () => { throw new Error('network must not be touched') }
  for (const runtime of [
    { skipPublishedTopicKeys: true, force: false, dryRun: true },
    { skipPublishedTopicKeys: false, force: false, dryRun: false },
  ]) {
    const guards = await resolvePublishedTopicGuards(runtime, { coverageDate: '2026-07-18', fetchImpl: failingFetch })
    assert.equal(guards.bypassed, true)
  }
})

// --- end-to-end over an injected fetch: list pass + per-post source fingerprints ---

function createBlogApiStub({ pages, details, failList = null, failDetails = new Set() }) {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(String(url))
    calls.push({ pathname: parsed.pathname, search: parsed.search, headers: options.headers || {} })
    if (parsed.pathname === '/api/posts') {
      const page = Number(parsed.searchParams.get('page') || 1)
      if (failList === page) throw new Error('backend unreachable')
      return jsonResponse({ items: pages[page - 1] || [] })
    }
    const slug = decodeURIComponent(parsed.pathname.replace('/api/posts/', ''))
    if (failDetails.has(slug)) return jsonResponse({ detail: 'nope' }, { ok: false, status: 503 })
    return jsonResponse(details[slug] || { sources: [], content_md: '' })
  }
  return { fetchImpl, calls }
}

test('fetchRecentPublishedTopicFingerprints reads the whole lookback window, not just today', async () => {
  const logger = createLogger()
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[
      { slug: 'ai-brief-2026-07-18-today', topic_key: 'today-key', coverage_date: '2026-07-18' },
      { slug: 'ai-brief-2026-07-16-two-days-ago', topic_key: 'older-key', coverage_date: '2026-07-16' },
      { slug: 'ai-brief-2026-06-01-way-old', topic_key: 'ancient', coverage_date: '2026-06-01' },
    ]],
    details: {
      'ai-brief-2026-07-18-today': { sources: [{ source_url: 'https://a.com/1' }] },
      'ai-brief-2026-07-16-two-days-ago': { sources: [{ source_url: 'https://b.com/1' }, { source_url: 'https://b.com/2' }] },
    },
  })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    fetchImpl,
    logger,
  })

  assert.equal(result.window_start, '2026-07-12')
  assert.equal(result.degraded, false)
  assert.deepEqual(result.fingerprints.map((entry) => entry.slug), [
    'ai-brief-2026-07-18-today',
    'ai-brief-2026-07-16-two-days-ago',
  ])
  assert.deepEqual([...result.fingerprints[1].source_urls], ['https://b.com/1', 'https://b.com/2'])
  // Only the same-day post feeds the legacy exact-key guard.
  assert.deepEqual([...result.same_day_topic_keys], ['today-key'])
  // The out-of-window post costs no detail request.
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 2)
  // Identifying as a bot keeps the scan out of view_count.
  assert.equal(calls[1].headers['User-Agent'], 'AutoBlogBot/3.0')
})

test('published posts without post_sources fall back to their reference links', async () => {
  const logger = createLogger()
  const { fetchImpl } = createBlogApiStub({
    pages: [[{ slug: 'ai-brief-2026-07-17-bridge-failed', topic_key: '', coverage_date: '2026-07-17' }]],
    details: {
      'ai-brief-2026-07-17-bridge-failed': {
        sources: [],
        content_md: [
          '![cover](https://cdn.example.com/cover.png)',
          '## 参考来源',
          '- [Launch post](https://openai.com/blog/launch) - OpenAI / official_blog',
          '- [Coverage](https://techcrunch.com/launch?utm_source=rss) - TechCrunch / industry_media',
        ].join('\n'),
      },
    },
  })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    fetchImpl,
    logger,
  })

  assert.deepEqual([...result.fingerprints[0].source_urls], [
    'https://openai.com/blog/launch',
    'https://techcrunch.com/launch',
  ])
  // topic_key was empty on the row, so it is recovered from the date-agnostic slug prefix.
  assert.equal(result.fingerprints[0].topic_key, 'bridge-failed')
})

test('extractReferenceUrlsFromMarkdown ignores images and the site\'s own links', () => {
  const urls = extractReferenceUrlsFromMarkdown([
    '![alt](https://cdn.example.com/inline.jpg)',
    '- [Source](https://openai.com/blog/x)',
    '- [Our own recap](https://www.563118077.xyz/posts/ai-brief-2026-07-17-x)',
    '- [Chart](https://static.example.com/plot.svg)',
  ].join('\n'), { excludeHosts: ['563118077.xyz'] })

  assert.deepEqual([...urls], ['https://openai.com/blog/x'])
})

// --- degradation must be loud ---

test('a failing post list degrades dedupe to a no-op and says so in the log', async () => {
  const logger = createLogger()
  const { fetchImpl } = createBlogApiStub({ pages: [[]], details: {}, failList: 1 })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    fetchImpl,
    logger,
  })

  assert.equal(result.degraded, true)
  assert.deepEqual(result.fingerprints, [])
  assert.equal(result.same_day_topic_keys.size, 0)
  assert.equal(logger.warns.length, 1)
  assert.match(logger.warns[0], /Cross-day dedupe DEGRADED/)
  assert.match(logger.warns[0], /backend unreachable/)
  assert.match(logger.warns[0], /duplicate topics may be republished/)

  // Degraded means "publish anyway", never "crash the run".
  const candidate = topic('anything', ['https://a.com/1', 'https://a.com/2'])
  const selection = selectTopicsForPublishing([candidate], {
    ...DEDUPE_RUNTIME,
    publishedTopicKeys: result.same_day_topic_keys,
    publishedTopicFingerprints: result.fingerprints,
  })
  assert.equal(selection.queue.length, 1)
})

test('an unreadable post detail is logged and drops only that post from the guard', async () => {
  const logger = createLogger()
  const { fetchImpl } = createBlogApiStub({
    pages: [[
      { slug: 'broken-post', topic_key: 'broken', coverage_date: '2026-07-17' },
      { slug: 'good-post', topic_key: 'good', coverage_date: '2026-07-17' },
    ]],
    details: { 'good-post': { sources: [{ source_url: 'https://a.com/1' }] } },
    failDetails: new Set(['broken-post']),
  })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    fetchImpl,
    logger,
  })

  assert.equal(result.degraded, true)
  assert.deepEqual(result.fingerprints.map((entry) => entry.slug), ['good-post'])
  assert.match(logger.warns.join('\n'), /could not read sources of published post "broken-post".*503/)
  assert.match(logger.logs.join('\n'), /1\/2 published posts fingerprinted since 2026-07-12 \(1 unreadable\)/)
})

test('the detail budget is capped and the truncation is reported', async () => {
  const logger = createLogger()
  const posts = Array.from({ length: 5 }, (_, index) => ({
    slug: `post-${index}`,
    topic_key: `key-${index}`,
    coverage_date: '2026-07-17',
  }))
  const details = Object.fromEntries(posts.map((post) => [post.slug, { sources: [{ source_url: `https://a.com/${post.slug}` }] }]))
  const { fetchImpl, calls } = createBlogApiStub({ pages: [posts], details })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    maxDetailFetches: 2,
    fetchImpl,
    logger,
  })

  assert.equal(result.scanned_post_count, 2)
  assert.equal(result.degraded, true)
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 2)
  assert.match(logger.warns.join('\n'), /exceed the 2-detail budget/)
})

test('paging stops as soon as a full page falls out of the lookback window', async () => {
  const logger = createLogger()
  const inWindow = Array.from({ length: 3 }, (_, index) => ({
    slug: `recent-${index}`,
    topic_key: `recent-${index}`,
    coverage_date: '2026-07-17',
  }))
  const outOfWindow = Array.from({ length: 3 }, (_, index) => ({
    slug: `old-${index}`,
    topic_key: `old-${index}`,
    coverage_date: '2026-01-01',
  }))
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [inWindow, outOfWindow, inWindow],
    details: Object.fromEntries(inWindow.map((post) => [post.slug, { sources: [{ source_url: `https://a.com/${post.slug}` }] }])),
  })

  await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-18',
    lookbackDays: 7,
    listPageSize: 3,
    maxListPages: 4,
    fetchImpl,
    logger,
  })

  const listCalls = calls.filter((call) => call.pathname === '/api/posts')
  assert.deepEqual(listCalls.map((call) => call.search), ['?page=1&page_size=3', '?page=2&page_size=3'])
})

// --- guard resolution end to end ---

test('resolvePublishedTopicGuards wires the window into both guards in one list pass', async () => {
  const logger = createLogger()
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[
      { slug: 'ai-brief-2026-07-18-today', topic_key: 'today-key', coverage_date: '2026-07-18' },
      { slug: 'ai-brief-2026-07-17-yesterday', topic_key: 'yesterday-key', coverage_date: '2026-07-17' },
    ]],
    details: {
      'ai-brief-2026-07-18-today': { sources: [{ source_url: 'https://a.com/1' }, { source_url: 'https://a.com/2' }] },
      'ai-brief-2026-07-17-yesterday': { sources: [{ source_url: 'https://b.com/1' }, { source_url: 'https://b.com/2' }] },
    },
  })

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig({}, {}),
    },
    { coverageDate: '2026-07-18', fetchImpl, logger },
  )

  assert.equal(guards.bypassed, false)
  assert.deepEqual([...guards.publishedTopicKeys], ['today-key'])
  assert.deepEqual(guards.publishedTopicFingerprints.map((entry) => entry.slug), [
    'ai-brief-2026-07-18-today',
    'ai-brief-2026-07-17-yesterday',
  ])
  // One list pass feeds both guards.
  assert.equal(calls.filter((call) => call.pathname === '/api/posts').length, 1)

  const selection = selectTopicsForPublishing(
    [
      topic('today-key', ['https://z.com/1', 'https://z.com/2']),
      topic('rerun-of-yesterday', ['https://b.com/1', 'https://b.com/2', 'https://c.com/1']),
      topic('genuinely-new', ['https://q.com/1', 'https://q.com/2', 'https://q.com/3']),
    ],
    {
      ...DEDUPE_RUNTIME,
      publishedTopicKeys: guards.publishedTopicKeys,
      publishedTopicFingerprints: guards.publishedTopicFingerprints,
    },
  )

  assert.deepEqual(selection.queue.map((entry) => entry.topic_key), ['genuinely-new'])
  assert.deepEqual(selection.skipped_topics.map((entry) => entry.reason), [
    'already published for coverage date',
    'source overlap 100% with ai-brief-2026-07-17-yesterday (2026-07-17)',
  ])
})

test('resolveCrossDayDedupeConfig falls back to defaults and clamps hostile values', () => {
  assert.deepEqual(resolveCrossDayDedupeConfig(), {
    enabled: true,
    lookbackDays: 7,
    overlapThreshold: 0.5,
    minSharedSources: 2,
    maxListPages: 4,
    listPageSize: 50,
    maxDetailFetches: 20,
    requestTimeoutMs: 10000,
  })

  // Mode config beats the root block.
  const merged = resolveCrossDayDedupeConfig(
    { cross_day_dedupe: { lookback_days: 14, overlap_threshold: 0.4 } },
    { cross_day_dedupe: { overlap_threshold: 0.65 } },
  )
  assert.equal(merged.lookbackDays, 14)
  assert.equal(merged.overlapThreshold, 0.65)

  const clamped = resolveCrossDayDedupeConfig({}, {
    cross_day_dedupe: {
      lookback_days: 9999,
      overlap_threshold: 12,
      min_shared_sources: 0,
      list_page_size: 500,
      request_timeout_ms: 'nonsense',
    },
  })
  assert.equal(clamped.lookbackDays, 60)
  assert.equal(clamped.overlapThreshold, 1)
  assert.equal(clamped.minSharedSources, 1)
  // The public list endpoint rejects page_size > 50.
  assert.equal(clamped.listPageSize, 50)
  assert.equal(clamped.requestTimeoutMs, 10000)

  assert.equal(resolveCrossDayDedupeConfig({}, { cross_day_dedupe: { enabled: false } }).enabled, false)
})

test('resolvePublishedTopicGuards keeps the same-day-only lookup when cross-day dedupe is off', async () => {
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[
      { slug: 'ai-brief-2026-07-18-today', topic_key: 'today-key', coverage_date: '2026-07-18' },
      { slug: 'ai-brief-2026-07-17-yesterday', topic_key: 'yesterday-key', coverage_date: '2026-07-17' },
    ]],
    details: {},
  })

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig({}, { cross_day_dedupe: { enabled: false } }),
    },
    { coverageDate: '2026-07-18', fetchImpl },
  )

  assert.deepEqual([...guards.publishedTopicKeys], ['today-key'])
  assert.deepEqual(guards.publishedTopicFingerprints, [])
  // No per-post detail traffic when the feature is off.
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 0)
})

// --- slug parsing ---

test('parseBriefSlug reads any coverage date out of a brief slug', () => {
  assert.deepEqual(parseBriefSlug('ai-brief-2026-07-16-model-launch-9f2a41bc'), {
    coverage_date: '2026-07-16',
    topic_key: 'model-launch-9f2a41bc',
  })
  assert.equal(parseBriefSlug('ai-brief-2026-07-16-'), null)
  assert.equal(parseBriefSlug('some-hand-written-post'), null)
  assert.equal(parseBriefSlug(''), null)
  assert.equal(parseBriefSlug(null), null)
})

test('fetchPublishedTopicKeys stays same-day-scoped after the slug parser was generalised', async () => {
  // Regression guard: parseBriefSlug is date-agnostic, but the legacy exact-key guard must
  // still ignore a slug stamped with another day.
  const keys = await fetchPublishedTopicKeys({
    coverageDate: '2026-07-17',
    fetchImpl: async () => jsonResponse({
      items: [
        { topic_key: 'today-explicit', slug: 'unrelated', coverage_date: '2026-07-17' },
        { slug: 'ai-brief-2026-07-17-legacy-today', coverage_date: '2026-07-17' },
        { slug: 'ai-brief-2026-07-16-legacy-yesterday', coverage_date: '2026-07-17' },
      ],
    }),
  })

  assert.deepEqual([...keys].sort(), ['legacy-today', 'today-explicit'])
})

test('shiftCoverageDate walks calendar days and survives junk input', () => {
  assert.equal(shiftCoverageDate('2026-07-18', -6), '2026-07-12')
  assert.equal(shiftCoverageDate('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftCoverageDate('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftCoverageDate('not-a-date', -6), 'not-a-date')
})
