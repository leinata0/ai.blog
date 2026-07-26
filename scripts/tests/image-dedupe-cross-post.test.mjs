import assert from 'node:assert/strict'
import test from 'node:test'

import {
  IMAGE_DEDUPE_DEFAULTS,
  createUsedImageRegistry,
  dedupeImagePlansAgainstUsed,
  extractInlineImageUrlsFromMarkdown,
  fetchRecentPublishedTopicFingerprints,
  fillSectionsFromHarvestedMedia,
  normalizeImageUrlForDedupe,
  resolveCrossDayDedupeConfig,
  resolveImageDedupeConfig,
  resolvePublishedTopicGuards,
  resolveUsedImageRegistry,
} from '../auto-blog.mjs'

// Production sampling (2026-07-26) over the 25 newest posts: 38 inline illustrations, only 23
// distinct URLs. Every repeat was an og:image / social card — one WordPress social endpoint
// showed up in five separate articles. Nothing in the pipeline had ever asked "did another
// article already use this picture?", so the tests below pin that question being asked, and
// pin the URL normalisation that makes it answerable across size renditions.

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body }, async text() { return '' } }
}

function createLogger() {
  const warns = []
  const logs = []
  return { warns, logs, warn: (message) => warns.push(String(message)), log: (message) => logs.push(String(message)) }
}

function plan(sectionHeading, imageUrl) {
  return {
    section_heading: sectionHeading,
    image_url: imageUrl,
    source_page_url: 'https://example.com/article',
    source_name: 'Example',
    alt_text: sectionHeading,
    score: 0.5,
  }
}

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

// --- URL normalisation: the part that decides whether dedupe works at all -----------------

test('size renditions of one asset collapse to a single dedupe key', () => {
  // The exact pair observed in production: Google truncates the generated file name when it
  // builds a smaller rendition, so the stems differ as well as the width suffix.
  const wide = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dxu1k2dx.width-1440.png'
  const narrow = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dx.width-200.png'
  assert.equal(normalizeImageUrlForDedupe(wide), normalizeImageUrlForDedupe(narrow))

  const pairs = [
    // `.max-WxH` — the FutureLabs_social card, seen three times.
    [
      'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/FutureLabs_social.max-1440x810.png',
      'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/FutureLabs_social.max-800x450.png',
    ],
    // WordPress `-WxH` renditions and the `-scaled` original.
    ['https://cdn.example.com/photo-1024x576.jpg', 'https://cdn.example.com/photo.jpg'],
    ['https://cdn.example.com/photo-scaled.jpg', 'https://cdn.example.com/photo.jpg'],
    // Retina variants.
    ['https://cdn.example.com/logo@2x.png', 'https://cdn.example.com/logo.png'],
    // Query-string renditions (photon/imgix style) plus tracking noise and fragments.
    ['https://i0.wp.com/x.com/a.jpg?resize=768%2C432&ssl=1', 'https://i0.wp.com/x.com/a.jpg'],
    ['https://cdn.example.com/a.jpg?w=1200&h=630&q=80&fm=webp', 'https://cdn.example.com/a.jpg'],
    ['https://cdn.example.com/a.jpg?utm_source=rss#hero', 'https://cdn.example.com/a.jpg'],
    // Host casing, `www.`, scheme and extension casing are all cosmetic.
    ['http://WWW.Example.com/pic.PNG', 'https://example.com/pic.png'],
    ['https://example.com/pic.png/', 'https://example.com/pic.png'],
  ]
  for (const [left, right] of pairs) {
    assert.equal(normalizeImageUrlForDedupe(left), normalizeImageUrlForDedupe(right), `${left} !== ${right}`)
  }
})

test('normalisation does not merge genuinely different images', () => {
  const distinct = [
    // The WordPress social-card endpoint encodes the whole image identity in `t`; dropping
    // every query parameter would have merged every card on the internet into one.
    ['https://s0.wp.com/_si/?t=eyJpbWciOiJhIn0', 'https://s0.wp.com/_si/?t=eyJpbWciOiJiIn0'],
    ['https://cdn.example.com/chart-a.png', 'https://cdn.example.com/chart-b.png'],
    ['https://cdn.example.com/a/pic.png', 'https://cdn.example.com/b/pic.png'],
    // Same path, different host — a CDN thumbnail host is not the origin host.
    ['https://cdn-thumbnails.huggingface.co/blog/x.png', 'https://huggingface.co/blog/x.png'],
    // Object-storage keys are case-sensitive, so path case must survive normalisation.
    ['https://cdn.example.com/Cover.png', 'https://cdn.example.com/cover.png'],
    // A two-digit `2x2` is not a size rendition.
    ['https://cdn.example.com/grid-2x2.png', 'https://cdn.example.com/grid.png'],
  ]
  for (const [left, right] of distinct) {
    assert.notEqual(normalizeImageUrlForDedupe(left), normalizeImageUrlForDedupe(right), `${left} === ${right}`)
  }
})

test('normalisation survives junk input without throwing', () => {
  assert.equal(normalizeImageUrlForDedupe(''), '')
  assert.equal(normalizeImageUrlForDedupe(null), '')
  assert.equal(normalizeImageUrlForDedupe('not a url'), 'not a url')
  assert.equal(normalizeImageUrlForDedupe('data:image/png;base64,AAAA'), 'data:image/png;base64,aaaa')
})

test('extractInlineImageUrlsFromMarkdown reads every markdown image shape once', () => {
  const urls = extractInlineImageUrlsFromMarkdown([
    '## 背景',
    '![alt text](https://cdn.example.com/one.png)',
    '![](https://cdn.example.com/two.png "标题")',
    '![angle](<https://cdn.example.com/three.png>)',
    '![dup](https://cdn.example.com/one.png)',
    '[not an image](https://example.com/article)',
    '![relative](/local/four.png)',
  ].join('\n'))

  assert.deepEqual(urls, [
    'https://cdn.example.com/one.png',
    'https://cdn.example.com/two.png',
    'https://cdn.example.com/three.png',
  ])
  assert.deepEqual(extractInlineImageUrlsFromMarkdown(''), [])
  assert.deepEqual(extractInlineImageUrlsFromMarkdown(null), [])
})

// --- exclusion: history and same batch ----------------------------------------------------

test('an illustration a recent article already used is dropped from the new article', () => {
  const logger = createLogger()
  const registry = createUsedImageRegistry([
    'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dxu1k2dx.width-1440.png',
  ])

  const kept = dedupeImagePlansAgainstUsed(
    [
      // Same picture, smaller rendition — the shape that made 40% of production images repeat.
      plan('## 背景', 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dx.width-200.png'),
      plan('## 影响', 'https://cdn.example.com/fresh.png'),
    ],
    registry,
    { logger },
  )

  assert.deepEqual(kept.map((entry) => entry.section_heading), ['## 影响'])
  assert.match(logger.logs.join('\n'), /Cross-post image dedupe dropped 1 illustration\(s\) already used elsewhere/)
  // The surviving image joins the memory, so the next article cannot reuse it either.
  assert.equal(registry.has('https://cdn.example.com/fresh.png'), true)
})

test('two articles published in the same run never share an illustration', () => {
  const registry = createUsedImageRegistry()
  const shared = 'https://cdn-thumbnails.huggingface.co/social-thumbnails/blog/nvidia/card.png'

  const first = dedupeImagePlansAgainstUsed(
    [plan('## 背景', shared), plan('## 影响', 'https://cdn.example.com/a.png')],
    registry,
    { logger: createLogger() },
  )
  // Second post of the same batch cites the same origin and gets the same social card back.
  const second = dedupeImagePlansAgainstUsed(
    [plan('## 背景', `${shared}?w=800`), plan('## 影响', 'https://cdn.example.com/b.png')],
    registry,
    { logger: createLogger() },
  )

  assert.equal(first.length, 2)
  assert.deepEqual(second.map((entry) => entry.image_url), ['https://cdn.example.com/b.png'])
  assert.equal(registry.size, 3)
})

test('duplicates inside one article are collapsed and empty plans are ignored', () => {
  const registry = createUsedImageRegistry()
  const kept = dedupeImagePlansAgainstUsed(
    [
      plan('## 一', 'https://cdn.example.com/a.png'),
      plan('## 二', 'https://cdn.example.com/a.jpg?w=200'),
      plan('## 三', 'https://cdn.example.com/a.jpg'),
      plan('## 四', ''),
    ],
    registry,
    { logger: createLogger() },
  )
  assert.deepEqual(kept.map((entry) => entry.section_heading), ['## 一', '## 二'])
})

test('a missing registry leaves the plans untouched', () => {
  const plans = [plan('## 背景', 'https://cdn.example.com/a.png')]
  assert.equal(dedupeImagePlansAgainstUsed(plans, null), plans)
  assert.deepEqual(dedupeImagePlansAgainstUsed(null, createUsedImageRegistry()), [])
})

// --- the fetch layer: one scan feeds both guards -------------------------------------------

test('published illustrations are harvested from the detail payloads the topic guard already reads', async () => {
  const logger = createLogger()
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[
      { slug: 'ai-brief-2026-07-25-one', topic_key: 'one', coverage_date: '2026-07-25' },
      { slug: 'ai-brief-2026-07-24-two', topic_key: 'two', coverage_date: '2026-07-24' },
      { slug: 'ai-brief-2026-01-01-ancient', topic_key: 'old', coverage_date: '2026-01-01' },
    ]],
    details: {
      // A post with a working metadata bridge: content_md must still be mined for images.
      'ai-brief-2026-07-25-one': {
        sources: [{ source_url: 'https://openai.com/blog/x' }],
        content_md: '## 背景\n\n![a](https://storage.googleapis.com/img/Gemini_Generated_Image_abcd.width-1440.png)\n',
      },
      'ai-brief-2026-07-24-two': {
        sources: [],
        content_md: '## 背景\n\n![b](https://cdn-thumbnails.huggingface.co/social-thumbnails/blog/Arm/x.png)\n',
      },
    },
  })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-26',
    lookbackDays: 14,
    collectImageUrls: true,
    fetchImpl,
    logger,
  })

  assert.deepEqual([...result.used_image_urls].sort(), [
    'cdn-thumbnails.huggingface.co/social-thumbnails/blog/Arm/x.png',
    'storage.googleapis.com/img/Gemini_Generated_Image_abcd.png',
  ])
  assert.equal(result.degraded, false)
  // Two detail requests total — the image memory rides on the topic scan, it does not add a round.
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 2)
  assert.match(logger.logs.join('\n'), /Cross-post image dedupe: 2 illustration fingerprint\(s\) collected from 2 published post\(s\) since 2026-07-13/)
})

test('image harvesting stays off unless it is asked for', async () => {
  const { fetchImpl } = createBlogApiStub({
    pages: [[{ slug: 'p', topic_key: 'p', coverage_date: '2026-07-25' }]],
    details: { p: { sources: [{ source_url: 'https://a.com/1' }], content_md: '![a](https://cdn.example.com/a.png)' } },
  })
  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-26',
    lookbackDays: 14,
    fetchImpl,
    logger: createLogger(),
  })
  assert.equal(result.used_image_urls.size, 0)
})

test('resolvePublishedTopicGuards feeds both guards from a single list pass', async () => {
  const logger = createLogger()
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[
      { slug: 'ai-brief-2026-07-26-today', topic_key: 'today-key', coverage_date: '2026-07-26' },
      { slug: 'ai-brief-2026-07-25-yesterday', topic_key: 'yesterday-key', coverage_date: '2026-07-25' },
    ]],
    details: {
      'ai-brief-2026-07-26-today': {
        sources: [{ source_url: 'https://a.com/1' }],
        content_md: '![x](https://cdn.example.com/today.png)',
      },
      'ai-brief-2026-07-25-yesterday': {
        sources: [{ source_url: 'https://b.com/1' }],
        content_md: '![y](https://cdn.example.com/yesterday-1024x576.png)',
      },
    },
  })

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig(),
      imageDedupe: resolveImageDedupeConfig(),
    },
    { coverageDate: '2026-07-26', fetchImpl, logger },
  )

  assert.equal(guards.bypassed, false)
  assert.deepEqual([...guards.publishedTopicKeys], ['today-key'])
  assert.equal(guards.publishedTopicFingerprints.length, 2)
  assert.equal(calls.filter((call) => call.pathname === '/api/posts').length, 1)
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 2)

  const registry = createUsedImageRegistry(guards.usedImageUrls)
  // The size rendition of yesterday's picture is recognised as the same picture.
  assert.equal(registry.has('https://cdn.example.com/yesterday.png'), true)
  assert.equal(registry.has('https://cdn.example.com/today.png'), true)
  assert.equal(registry.has('https://cdn.example.com/unseen.png'), false)
})

test('the wider image window does not widen the cross-day topic window', async () => {
  // Image dedupe remembers 14 days, topic dedupe judges 7. Sharing one scan must not let the
  // 8-day-old post start blocking topics.
  const { fetchImpl } = createBlogApiStub({
    pages: [[
      { slug: 'recent', topic_key: 'recent', coverage_date: '2026-07-25' },
      { slug: 'older', topic_key: 'older', coverage_date: '2026-07-16' },
    ]],
    details: {
      recent: { sources: [{ source_url: 'https://a.com/1' }], content_md: '![a](https://cdn.example.com/recent.png)' },
      older: { sources: [{ source_url: 'https://b.com/1' }], content_md: '![b](https://cdn.example.com/older.png)' },
    },
  })

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig(),
      imageDedupe: resolveImageDedupeConfig(),
    },
    { coverageDate: '2026-07-26', fetchImpl, logger: createLogger() },
  )

  assert.deepEqual(guards.publishedTopicFingerprints.map((entry) => entry.slug), ['recent'])
  // …but its illustration is still remembered.
  const registry = createUsedImageRegistry(guards.usedImageUrls)
  assert.equal(registry.has('https://cdn.example.com/older.png'), true)
})

// --- degradation must be loud, and must never block a publish -----------------------------

test('a failing post list degrades the image memory to empty and warns about it', async () => {
  const logger = createLogger()
  const { fetchImpl } = createBlogApiStub({ pages: [[]], details: {}, failList: 1 })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-26',
    lookbackDays: 14,
    collectImageUrls: true,
    fetchImpl,
    logger,
  })

  assert.equal(result.degraded, true)
  assert.equal(result.used_image_urls.size, 0)
  assert.match(logger.warns.join('\n'), /duplicate topics and duplicate illustrations may be republished/)
  assert.match(logger.warns.join('\n'), /Cross-post image dedupe DEGRADED/)

  // Degraded means "publish with a blank memory", never "crash the run".
  const registry = createUsedImageRegistry(result.used_image_urls)
  const plans = [plan('## 背景', 'https://cdn.example.com/a.png')]
  assert.deepEqual(dedupeImagePlansAgainstUsed(plans, registry, { logger }), plans)
})

test('an unreadable post detail warns and only loses that post\'s illustrations', async () => {
  const logger = createLogger()
  const { fetchImpl } = createBlogApiStub({
    pages: [[
      { slug: 'broken-post', topic_key: 'broken', coverage_date: '2026-07-25' },
      { slug: 'good-post', topic_key: 'good', coverage_date: '2026-07-25' },
    ]],
    details: { 'good-post': { sources: [], content_md: '![g](https://cdn.example.com/good.png)' } },
    failDetails: new Set(['broken-post']),
  })

  const result = await fetchRecentPublishedTopicFingerprints({
    coverageDate: '2026-07-26',
    lookbackDays: 14,
    collectImageUrls: true,
    fetchImpl,
    logger,
  })

  assert.deepEqual([...result.used_image_urls], ['cdn.example.com/good.png'])
  assert.equal(result.degraded, true)
  assert.match(logger.warns.join('\n'), /could not read sources of published post "broken-post".*503/)
  assert.match(logger.warns.join('\n'), /Cross-post image dedupe DEGRADED/)
})

test('resolveUsedImageRegistry degrades to an empty memory when the scan throws', async () => {
  const logger = createLogger()
  const registry = await resolveUsedImageRegistry(
    { imageDedupe: resolveImageDedupeConfig(), force: false, dryRun: false },
    {
      coverageDate: '2026-07-26',
      fetchImpl: async () => { throw new Error('boom') },
      logger,
    },
  )

  assert.equal(registry.size, 0)
  // The list-page failure is reported by the shared scan; the run still continues.
  assert.match(logger.warns.join('\n'), /DEGRADED/)
})

// --- --force and the other bypasses --------------------------------------------------------

test('--force bypasses the published-image lookup without issuing a request', async () => {
  const failingFetch = async () => { throw new Error('network must not be touched under --force') }

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: true,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig(),
      imageDedupe: resolveImageDedupeConfig(),
    },
    { coverageDate: '2026-07-26', fetchImpl: failingFetch },
  )
  assert.equal(guards.bypassed, true)
  assert.equal(guards.usedImageUrls.size, 0)

  const registry = await resolveUsedImageRegistry(
    { imageDedupe: resolveImageDedupeConfig(), force: true, dryRun: false },
    { coverageDate: '2026-07-26', fetchImpl: failingFetch },
  )
  assert.equal(registry.size, 0)

  // With an empty memory nothing is excluded — a --force rerun can reuse whatever it likes…
  const previouslyUsed = 'https://cdn.example.com/already-published.png'
  const plans = [plan('## 背景', previouslyUsed)]
  assert.deepEqual(
    dedupeImagePlansAgainstUsed(plans, createUsedImageRegistry(guards.usedImageUrls), { logger: createLogger() }),
    plans,
  )
})

test('dry runs and a disabled feature flag also skip the lookup', async () => {
  const failingFetch = async () => { throw new Error('network must not be touched') }

  for (const runtime of [
    { imageDedupe: resolveImageDedupeConfig(), dryRun: true, force: false },
    { imageDedupe: resolveImageDedupeConfig({}, { image_dedupe: { enabled: false } }), dryRun: false, force: false },
  ]) {
    const registry = await resolveUsedImageRegistry(runtime, { coverageDate: '2026-07-26', fetchImpl: failingFetch })
    assert.equal(registry.size, 0)
  }

  // Both guards off means the legacy same-day-only lookup and no detail traffic at all.
  const { fetchImpl, calls } = createBlogApiStub({
    pages: [[{ slug: 'ai-brief-2026-07-26-today', topic_key: 'today-key', coverage_date: '2026-07-26' }]],
    details: {},
  })
  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig({}, { cross_day_dedupe: { enabled: false } }),
      imageDedupe: resolveImageDedupeConfig({}, { image_dedupe: { enabled: false } }),
    },
    { coverageDate: '2026-07-26', fetchImpl },
  )
  assert.equal(guards.usedImageUrls.size, 0)
  assert.equal(calls.filter((call) => call.pathname.startsWith('/api/posts/')).length, 0)
})

test('image dedupe still runs when cross-day topic dedupe is switched off', async () => {
  const { fetchImpl } = createBlogApiStub({
    pages: [[{ slug: 'p', topic_key: 'p-key', coverage_date: '2026-07-25' }]],
    details: { p: { sources: [{ source_url: 'https://a.com/1' }], content_md: '![a](https://cdn.example.com/a.png)' } },
  })

  const guards = await resolvePublishedTopicGuards(
    {
      skipPublishedTopicKeys: true,
      force: false,
      dryRun: false,
      crossDayDedupe: resolveCrossDayDedupeConfig({}, { cross_day_dedupe: { enabled: false } }),
      imageDedupe: resolveImageDedupeConfig(),
    },
    { coverageDate: '2026-07-26', fetchImpl, logger: createLogger() },
  )

  assert.deepEqual(guards.publishedTopicFingerprints, [])
  assert.deepEqual([...guards.usedImageUrls], ['cdn.example.com/a.png'])
})

// --- config ---------------------------------------------------------------------------------

test('resolveImageDedupeConfig falls back to defaults and clamps hostile values', () => {
  assert.deepEqual(resolveImageDedupeConfig(), {
    enabled: true,
    lookbackDays: 14,
    maxListPages: 4,
    listPageSize: 50,
    maxDetailFetches: 30,
    requestTimeoutMs: 10000,
  })
  assert.equal(IMAGE_DEDUPE_DEFAULTS.enabled, true)

  const merged = resolveImageDedupeConfig(
    { image_dedupe: { lookback_days: 21, max_detail_fetches: 40 } },
    { image_dedupe: { lookback_days: 30 } },
  )
  assert.equal(merged.lookbackDays, 30)
  assert.equal(merged.maxDetailFetches, 40)

  const clamped = resolveImageDedupeConfig({}, {
    image_dedupe: { lookback_days: 9999, list_page_size: 500, max_detail_fetches: -5, request_timeout_ms: 'nonsense' },
  })
  assert.equal(clamped.lookbackDays, 90)
  // The public list endpoint rejects page_size > 50.
  assert.equal(clamped.listPageSize, 50)
  assert.equal(clamped.maxDetailFetches, 0)
  assert.equal(clamped.requestTimeoutMs, 10000)
})

// --- 新增图源必须服从同一套去重 -------------------------------------------------------
//
// 供给侧接上了两路新图源（feed 正文 / jina markdown）。覆盖率上去了，重复的风险也跟着
// 上去：同一张图会同时出现在 RSS 正文、jina markdown 和源站页面里。上一轮建立的跨文章
// 记忆必须原样管住这些新候选，否则「不重复」是靠少配图换来的这件事又会倒回去。

const HARVEST_RULES = {
  min_width: 240,
  min_height: 140,
  blocklist_keywords: ['logo', 'avatar', 'social'],
}

function mediaSource(sourceId, pageUrl, urls) {
  return {
    source_id: sourceId,
    url: pageUrl,
    source_name: 'Example',
    title: 'Example story',
    media_candidates: urls.map((url) => ({ url, alt: '', caption: '', context: '', width: 1200, height: 700 })),
  }
}

test('a harvested illustration a recent article already used is refused at pick time', () => {
  const registry = createUsedImageRegistry(['https://cdn.example.com/gemini.width-1440.png'])
  const { plans, stats } = fillSectionsFromHarvestedMedia({
    sections: ['## 背景'],
    existingPlans: [],
    // 同一张图的另一个 rendition：raw URL 不同，规范化之后是同一个键。
    sourceItems: [mediaSource('S1', 'https://example.com/a', ['https://cdn.example.com/gemini.width-800.png'])],
    attribution: {},
    rules: HARVEST_RULES,
    isExcluded: registry.has,
  })
  assert.deepEqual(plans, [])
  assert.equal(stats.rejected.already_published, 1)
})

test('harvested picks join the cross-post memory so the next post of the run cannot reuse them', () => {
  const registry = createUsedImageRegistry()
  const harvestOnce = () => fillSectionsFromHarvestedMedia({
    sections: ['## 背景'],
    existingPlans: [],
    sourceItems: [mediaSource('S1', 'https://example.com/a', [
      'https://cdn.example.com/chart.png',
      'https://cdn.example.com/other.png',
    ])],
    attribution: {},
    rules: HARVEST_RULES,
    isExcluded: registry.has,
    logger: createLogger(),
  }).plans

  // 第一篇：pick 之后必须像 picker 的产出一样过一遍 dedupeImagePlansAgainstUsed，
  // 由它写回记忆。这正是 buildPublishablePost 里的接法。
  const first = dedupeImagePlansAgainstUsed(harvestOnce(), registry, { logger: createLogger() })
  assert.equal(first.length, 1)
  assert.equal(registry.has('https://cdn.example.com/chart.png'), true)

  // 第二篇：同一批候选，第一张已被记住，于是自动落到下一张，而不是重复或空手。
  const second = dedupeImagePlansAgainstUsed(harvestOnce(), registry, { logger: createLogger() })
  assert.deepEqual(second.map((entry) => entry.image_url), ['https://cdn.example.com/other.png'])
})

test('rendition suffixes stacked by the gweb-uniblog CDN still fold to one harvested key', () => {
  // 上一轮修过的形状：`.width-1200.format-webp.webp`。新图源同样要认得它，
  // 否则一张 Google 截图会以两种 rendition 各占一个章节。
  const registry = createUsedImageRegistry([
    'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Shot.width-1200.format-webp.webp',
  ])
  const { plans } = fillSectionsFromHarvestedMedia({
    sections: ['## 背景'],
    existingPlans: [],
    sourceItems: [mediaSource('S1', 'https://blog.google/a', [
      'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Shot.width-600.format-webp.webp',
    ])],
    attribution: {},
    rules: HARVEST_RULES,
    isExcluded: registry.has,
  })
  assert.deepEqual(plans, [])
})

test('a harvested plan cannot collide with an image the source-page picker already placed', () => {
  const { plans } = fillSectionsFromHarvestedMedia({
    sections: ['## 一', '## 二'],
    existingPlans: [plan('## 一', 'https://cdn.example.com/photo.jpg')],
    sourceItems: [mediaSource('S1', 'https://example.com/a', [
      'https://cdn.example.com/photo.jpg?w=800',
      'https://cdn.example.com/second.jpg',
    ])],
    attribution: {},
    rules: HARVEST_RULES,
    logger: createLogger(),
  })
  assert.deepEqual(plans.map((entry) => entry.image_url), [
    'https://cdn.example.com/photo.jpg',
    'https://cdn.example.com/second.jpg',
  ])
})

test('registering the harvested additions does not un-register the picker plans', () => {
  // dedupeImagePlansAgainstUsed 既过滤又写回记忆。把「picker 结果 + 新补的图」整体再喂它
  // 一遍，picker 那几张会被判成自己的重复而全部丢掉 —— 文章反而从有图变没图。
  // 所以 fillSectionsFromHarvestedMedia 单独返回 added，只有新增的那部分才进第二次去重。
  const registry = createUsedImageRegistry()
  const pickerPlans = dedupeImagePlansAgainstUsed(
    [plan('## 一', 'https://cdn.example.com/picked.png')],
    registry,
    { logger: createLogger() },
  )
  assert.equal(pickerPlans.length, 1)

  const harvested = fillSectionsFromHarvestedMedia({
    sections: ['## 一', '## 二'],
    existingPlans: pickerPlans,
    sourceItems: [mediaSource('S1', 'https://example.com/a', ['https://cdn.example.com/harvested.png'])],
    attribution: {},
    rules: HARVEST_RULES,
    isExcluded: registry.has,
    logger: createLogger(),
  })
  assert.deepEqual(harvested.added.map((entry) => entry.section_heading), ['## 二'])

  const finalPlans = [
    ...pickerPlans,
    ...dedupeImagePlansAgainstUsed(harvested.added, registry, { logger: createLogger() }),
  ]
  assert.deepEqual(finalPlans.map((entry) => entry.image_url), [
    'https://cdn.example.com/picked.png',
    'https://cdn.example.com/harvested.png',
  ])
  assert.equal(registry.size, 2)
})
