import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AUTO_BLOG_CLI_HELP,
  buildClusterTopicKey,
  buildLLMMaxTokenAttempts,
  buildPublishingMetadataBridgePayload,
  callLLM,
  createSkippableTopicError,
  ensureSectionHeading,
  isProviderParameterRejection,
  isRetryableHttpStatus,
  isSkippableTopicError,
  parseRetryAfterMs,
  readSectionMarkdown,
  runPublishingBridges,
  spliceRepairedSections,
  validateArticlePackagePayload,
  validateOutlinePayload,
  validateSectionPayload,
  loginAdminWithRetry,
  parseJsonFromLlm,
  assessResearchPackSourceSupport,
  buildTopicKey,
  clusterResearchItemsByTopic,
  createDailyBriefFormatProfile,
  fillMissingIllustrations,
  filterItemsForCoverageWindow,
  normalizeOutlineHeadings,
  normalizeSectionBriefs,
  parseCliArgs,
  pickPostCountForRun,
  prepareImagePlansForPublication,
  selectTopicsForPublishing,
  sendPublishRequest,
} from '../auto-blog.mjs'

// POST /api/admin/illustrations/generate used to run the model inline and answer with the
// finished image; it now only enqueues a job. The old `result.generated && result.image_url`
// check therefore saw false/"" on every call and dropped the illustration — while the backend
// went on generating, billing and uploading it, leaving an orphan in R2. The enqueue-then-poll
// shape is the contract, so it gets a test.
test('illustration fallback polls the enqueued job instead of reading the submit response', async () => {
  const requestedUrls = []
  const enqueued = { job_id: 77, status: 'queued', generated: false, image_url: '' }

  const plans = await fillMissingIllustrations({
    desiredSections: ['## 模型进展'],
    existingPlans: [],
    outline: { topic: 'AI' },
    config: { ai_illustration_enabled: true },
    resolveToken: async () => 'test-token',
    blogApiBase: 'https://api.example.com',
    fetchImpl: async (url) => {
      requestedUrls.push(String(url))
      return { ok: true, status: 200, json: async () => enqueued }
    },
    waitForJob: async ({ jobId, initialJob }) => {
      assert.equal(jobId, 77)
      assert.equal(initialJob, enqueued)
      return { job_id: jobId, status: 'succeeded', result_image_url: 'https://img.example.com/a.png' }
    },
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://img.example.com/a.png')
  assert.equal(plans[0].section_heading, '## 模型进展')
  assert.equal(plans[0].reason, 'ai_fallback')
  assert.deepEqual(requestedUrls, ['https://api.example.com/api/admin/illustrations/generate'])
})

test('an illustration job that never succeeds contributes no plan', async () => {
  const plans = await fillMissingIllustrations({
    desiredSections: ['## 模型进展'],
    existingPlans: [],
    outline: { topic: 'AI' },
    config: { ai_illustration_enabled: true },
    resolveToken: async () => 'test-token',
    blogApiBase: 'https://api.example.com',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ job_id: 9, status: 'queued' }) }),
    // A backgrounded job that outlives the poll budget must not be treated as an image.
    waitForJob: async () => ({ job_id: 9, status: 'running', error_code: 'poll_timeout' }),
  })

  assert.deepEqual(plans, [])
})

test('dry-run image preparation keeps inspectable external candidates without localizing', async () => {
  const plans = [{ section_heading: '## Test', image_url: 'https://cdn.example.com/image.png' }]
  let localizationCalls = 0
  const result = await prepareImagePlansForPublication(plans, {
    imageUploadToken: '',
    localize: async () => {
      localizationCalls += 1
      throw new Error('dry runs must not upload')
    },
  })

  assert.deepEqual(result, plans)
  assert.equal(localizationCalls, 0)
})

test('parseJsonFromLlm accepts fenced JSON with a closing fence', () => {
  assert.deepEqual(parseJsonFromLlm('```json\n{"topic":"AI agents","keywords":["agent"]}\n```'), {
    topic: 'AI agents',
    keywords: ['agent'],
  })
})

test('parseJsonFromLlm accepts fenced JSON without a closing fence', () => {
  assert.deepEqual(parseJsonFromLlm('```json\n{"topic":"AI agents","keywords":["agent"]}'), {
    topic: 'AI agents',
    keywords: ['agent'],
  })
})

test('parseJsonFromLlm extracts JSON embedded in prose', () => {
  assert.deepEqual(parseJsonFromLlm('Here is the JSON:\n{"topic":"AI agents","keywords":["agent"]}\nDone.'), {
    topic: 'AI agents',
    keywords: ['agent'],
  })
})

test('parseJsonFromLlm reports truncated top-level JSON clearly', () => {
  assert.throws(
    () => parseJsonFromLlm('```json\n{"topic":"AI agents","keywords":["agent"],'),
    /JSON appears truncated/
  )
})

test('callLLM keeps the full token budget when the output is truncated', async () => {
  const usedMaxTokens = []
  const result = await callLLM('system', 'user', 8192, {
    getToken: async () => 'token',
    sleepImpl: async () => {},
    logger: null,
    generateText: async ({ maxTokens }) => {
      usedMaxTokens.push(maxTokens)
      // First call returns truncated JSON; second call returns valid JSON.
      if (usedMaxTokens.length === 1) return '```json\n{"topic":"AI",'
      return '{"topic":"AI agents"}'
    },
  })

  assert.deepEqual(result, { topic: 'AI agents' })
  // Truncation must NOT shrink the budget — both attempts keep the requested 8192.
  assert.ok(usedMaxTokens.every((value) => value === 8192), `expected all 8192, got ${usedMaxTokens}`)
})

test('callLLM steps the token ladder down only when the provider rejects', async () => {
  const usedMaxTokens = []
  const result = await callLLM('system', 'user', 16384, {
    getToken: async () => 'token',
    sleepImpl: async () => {},
    logger: null,
    generateText: async ({ maxTokens }) => {
      usedMaxTokens.push(maxTokens)
      // Provider rejects the first full-budget attempt (both jsonMode passes), then accepts.
      if (maxTokens === 16384) throw new Error('Admin text generation failed: 400 max_tokens too high')
      return '{"topic":"AI agents"}'
    },
  })

  assert.deepEqual(result, { topic: 'AI agents' })
  // First attempt rejected at 16384 (twice), retry steps down to 8192.
  assert.equal(usedMaxTokens[0], 16384)
  assert.equal(usedMaxTokens.at(-1), 8192)
})

test('callLLM recovers from a stale token by clearing the cache and re-authenticating', async () => {
  let calls = 0
  let cleared = 0
  const tokens = []
  const result = await callLLM('system', 'user', 4096, {
    getToken: async () => (cleared === 0 ? 'stale-token' : 'fresh-token'),
    clearToken: () => { cleared += 1 },
    sleepImpl: async () => {},
    logger: null,
    generateText: async ({ token }) => {
      calls += 1
      tokens.push(token)
      // The cached token has expired: the first call 401s, then the loop clears the
      // cache, re-logs in, and the retry with the fresh token succeeds.
      if (token === 'stale-token') throw new Error('Admin text generation failed: 401 unauthorized')
      return '{"topic":"AI agents"}'
    },
  })

  assert.deepEqual(result, { topic: 'AI agents' })
  assert.equal(cleared, 1)
  assert.deepEqual(tokens, ['stale-token', 'fresh-token'])
})

test('callLLM re-raises auth failures that persist after re-authentication', async () => {
  let calls = 0
  let cleared = 0
  await assert.rejects(
    callLLM('system', 'user', 4096, {
      getToken: async () => 'token',
      clearToken: () => { cleared += 1 },
      sleepImpl: async () => {},
      logger: null,
      generateText: async () => {
        calls += 1
        // A genuine credentials problem: re-login does not help, so the second 401 throws.
        throw new Error('Admin text generation failed: 401 unauthorized')
      },
    }),
    /401/
  )
  // One reauth attempt: first 401 clears + retries, second 401 re-raises.
  assert.equal(calls, 2)
  assert.equal(cleared, 1)
})

test('sendPublishRequest retries transient 5xx and returns the eventual success body', async () => {
  let calls = 0
  const sleeps = []
  const result = await sendPublishRequest({
    url: 'https://blog.example.com/api/admin/posts',
    method: 'POST',
    requestBody: { title: 'x' },
    token: 'token',
    retryDelaysMs: [10, 20, 30],
    sleepImpl: async (ms) => sleeps.push(ms),
    logger: null,
    fetchImpl: async () => {
      calls += 1
      if (calls < 3) return { ok: false, status: 503, async text() { return 'busy' } }
      return { ok: true, status: 200, async json() { return { id: 42 } } }
    },
  })

  assert.deepEqual(result, { ok: true, status: 200, json: { id: 42 } })
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [10, 20])
})

test('sendPublishRequest does not retry deterministic 4xx errors', async () => {
  let calls = 0
  await assert.rejects(
    sendPublishRequest({
      url: 'https://blog.example.com/api/admin/posts',
      method: 'POST',
      requestBody: { title: 'x' },
      token: 'token',
      retryDelaysMs: [10, 20],
      sleepImpl: async () => {},
      logger: null,
      fetchImpl: async () => {
        calls += 1
        return { ok: false, status: 422, async text() { return 'invalid' } }
      },
    }),
    /422/
  )
  assert.equal(calls, 1)
})

test('sendPublishRequest surfaces 409 to the caller without retrying', async () => {
  let calls = 0
  const result = await sendPublishRequest({
    url: 'https://blog.example.com/api/admin/posts',
    method: 'POST',
    requestBody: { title: 'x' },
    token: 'token',
    retryDelaysMs: [10, 20],
    sleepImpl: async () => {},
    logger: null,
    fetchImpl: async () => {
      calls += 1
      return { ok: false, status: 409, async text() { return 'conflict' } }
    },
  })

  assert.deepEqual(result, { ok: false, status: 409, json: null })
  assert.equal(calls, 1)
})

test('loginAdminWithRetry retries transient admin login failures', async () => {
  const calls = []
  const sleeps = []
  const token = await loginAdminWithRetry({
    blogApiBase: 'https://blog.example.com',
    username: 'admin',
    password: 'secret',
    retryDelaysMs: [10, 20],
    sleepImpl: async (ms) => sleeps.push(ms),
    logger: null,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (calls.length === 1) {
        return { ok: false, status: 503 }
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: 'admin-token' }
        },
      }
    },
  })

  assert.equal(token, 'admin-token')
  assert.equal(calls.length, 2)
  assert.deepEqual(sleeps, [10])
  assert.equal(calls[0].url, 'https://blog.example.com/api/admin/login')
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    username: 'admin',
    password: 'secret',
  })
})

test('loginAdminWithRetry does not retry auth failures', async () => {
  let calls = 0
  await assert.rejects(
    loginAdminWithRetry({
      blogApiBase: 'https://blog.example.com',
      username: 'admin',
      password: 'wrong',
      retryDelaysMs: [10, 20],
      sleepImpl: async () => {},
      logger: null,
      fetchImpl: async () => {
        calls += 1
        return { ok: false, status: 401 }
      },
    }),
    /Admin login failed: 401/
  )
  assert.equal(calls, 1)
})

test('callLLM max token attempts fall back under common provider limits', () => {
  assert.deepEqual(buildLLMMaxTokenAttempts(16384), [16384, 8192, 4096, 3072])
  assert.deepEqual(buildLLMMaxTokenAttempts(6144), [6144, 4096, 3072])
  assert.deepEqual(buildLLMMaxTokenAttempts(3072), [3072])
})

test('parseCliArgs understands mode, max-posts and coverage date', () => {
  const result = parseCliArgs([
    '--mode',
    'daily-manual',
    '--max-posts',
    '3',
    '--coverage-date',
    '2026-04-14',
    '--dry-run',
    '--force',
  ])

  assert.deepEqual(result, {
    dryRun: true,
    mode: 'daily-manual',
    maxPosts: 3,
    coverageDate: '2026-04-14',
    force: true,
    help: false,
  })
})

test('buildTopicKey produces stable short keys', () => {
  const key = buildTopicKey({
    title: 'OpenAI launches a new developer agent workflow',
    summary: 'The launch targets developers and code review workflows.',
  })

  assert.ok(key.length > 0)
  assert.ok(key.length <= 80)
})

test('pickPostCountForRun randomizes daily auto count between min and max', () => {
  assert.equal(pickPostCountForRun({ mode: 'daily-auto', minPosts: 1, maxPosts: 2, randomValue: 0.1 }), 1)
  assert.equal(pickPostCountForRun({ mode: 'daily-auto', minPosts: 1, maxPosts: 2, randomValue: 0.9 }), 2)
  assert.equal(pickPostCountForRun({ mode: 'daily-manual', minPosts: 1, maxPosts: 3, randomValue: 0.1 }), 3)
})

test('createDailyBriefFormatProfile is now a free-structure profile', () => {
  const profile = createDailyBriefFormatProfile()

  // Daily briefs no longer fill a fixed 5-section template; the LLM authors its own
  // chapters and quality is enforced by dimension coverage instead of heading match.
  assert.equal(profile.structure_mode, 'free')
  assert.deepEqual(profile.required_sections, [])
  assert.ok(Array.isArray(profile.required_dimensions) && profile.required_dimensions.length > 0)
  // Tail blocks are still program-appended.
  assert.ok(profile.required_tail_sections.includes('## 图片来源'))
})

test('filterItemsForCoverageWindow respects lookback_hours and keeps undated fallback behind fresh items', () => {
  const items = filterItemsForCoverageWindow([
    {
      title: 'Fresh official update',
      summary: 'fresh',
      full_text: 'fresh',
      url: 'https://example.com/fresh',
      source_name: 'OpenAI Blog',
      published_at: '2026-04-16T08:00:00Z',
      score: 0.9,
    },
    {
      title: 'Old official update',
      summary: 'old',
      full_text: 'old',
      url: 'https://example.com/old',
      source_name: 'Google AI',
      published_at: '2026-04-02T08:00:00Z',
      score: 1.2,
    },
    {
      title: 'Undated note',
      summary: 'undated',
      full_text: 'undated',
      url: 'https://example.com/undated',
      source_name: 'Hacker News',
      published_at: '',
      score: 0.2,
    },
  ], {
    coverageDate: '2026-04-16',
    lookbackHours: 30,
    minItems: 1,
  })

  assert.deepEqual(items.map((item) => item.title), [
    'Fresh official update',
    'Undated note',
  ])
})

test('clusterResearchItemsByTopic merges overlapping sources and records diversity stats', () => {
  const clusters = clusterResearchItemsByTopic([
    {
      title: 'OpenAI launches new developer agent',
      summary: 'A new agent workflow for coding teams.',
      full_text: 'OpenAI launches a developer agent for code review workflows.',
      url: 'https://example.com/a',
      source_name: 'OpenAI Blog',
      source_group: 'openai',
      channel_bucket: 'official_vendor',
      published_at: '2026-04-14T02:00:00Z',
      score: 0.8,
    },
    {
      title: 'New developer agent from OpenAI',
      summary: 'The OpenAI agent is aimed at developer teams.',
      full_text: 'Developer teams can use the new OpenAI agent for review and execution.',
      url: 'https://example.com/b',
      source_name: 'TechCrunch AI',
      source_group: 'techcrunch',
      channel_bucket: 'global_media',
      published_at: '2026-04-14T03:00:00Z',
      score: 0.75,
    },
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].source_count, 2)
  assert.equal(clusters[0].bucket_count, 2)
  assert.equal(clusters[0].non_official_source_count, 1)
  assert.deepEqual([...clusters[0].source_groups].sort(), ['openai', 'techcrunch'])
})

test('selectTopicsForPublishing favors diverse topics when source counts are close', () => {
  const result = selectTopicsForPublishing(
    [
      {
        topic_key: 'single-official',
        source_count: 3,
        bucket_count: 1,
        non_official_source_count: 0,
        score: 3,
        latest_published_at: '2026-04-14T03:00:00Z',
        items: [{}],
      },
      {
        topic_key: 'mixed-viewpoints',
        source_count: 3,
        bucket_count: 3,
        non_official_source_count: 2,
        score: 2.9,
        latest_published_at: '2026-04-14T02:00:00Z',
        items: [{}],
      },
      {
        topic_key: 'below-threshold',
        source_count: 1,
        bucket_count: 1,
        non_official_source_count: 1,
        score: 5,
        latest_published_at: '2026-04-14T04:00:00Z',
        items: [{}],
      },
    ],
    {
      maxPosts: 2,
      minSourcesPerTopic: 2,
      publishedTopicKeys: new Set([]),
    },
  )

  assert.equal(result.queue.length, 3)
  assert.equal(result.queue[0].topic_key, 'mixed-viewpoints')
  assert.equal(result.queue[2].topic_key, 'below-threshold')
  assert.equal(result.target_count, 2)
})

test('assessResearchPackSourceSupport blocks thin daily topics before drafting', () => {
  const support = assessResearchPackSourceSupport({
    researchPack: {
      sources: [
        { source_type: 'industry_media', source_name: 'TechCrunch AI', url: 'https://example.com/a', title: 'A' },
        { source_type: 'industry_media', source_name: 'QbitAI', url: 'https://example.com/b', title: 'B' },
      ],
    },
    gateProfile: {
      min_sources: 2,
      min_high_quality_sources: 1,
      high_quality_source_types: ['official_blog', 'independent_blog', 'paper'],
    },
  })

  assert.equal(support.passed, false)
  assert.deepEqual(support.reasons, ['high_quality_sources:0<1'])
})

test('assessResearchPackSourceSupport accepts packs with enough curated support', () => {
  const support = assessResearchPackSourceSupport({
    researchPack: {
      sources: [
        { source_type: 'industry_media', source_name: '雷锋网', url: 'https://example.com/a', title: 'A' },
        { source_type: 'independent_blog', source_name: 'QbitAI', url: 'https://example.com/b', title: 'B' },
      ],
    },
    gateProfile: {
      min_sources: 2,
      min_high_quality_sources: 1,
      high_quality_source_types: ['official_blog', 'independent_blog', 'paper'],
    },
  })

  assert.equal(support.passed, true)
  assert.deepEqual(support.reasons, [])
})

test('normalizeOutlineHeadings normalizes and dedupes LLM-authored headings', () => {
  const headings = normalizeOutlineHeadings({
    outline: ['模型发布的真实变化', '## 已带前缀的标题', '### 三级会被降为二级', '模型发布的真实变化'],
  })

  assert.deepEqual(headings, ['## 模型发布的真实变化', '## 已带前缀的标题', '## 三级会被降为二级'])
})

test('normalizeOutlineHeadings falls back to section_briefs headings when outline array is absent', () => {
  const headings = normalizeOutlineHeadings({
    section_briefs: [{ heading: '甲章节' }, { heading: '## 乙章节' }],
  })

  assert.deepEqual(headings, ['## 甲章节', '## 乙章节'])
})

test('normalizeSectionBriefs (free mode) follows the authored outline order and carries dimension', () => {
  const briefs = normalizeSectionBriefs(
    {
      outline: ['## 甲', '## 乙', '## 丙'],
      section_briefs: [
        { heading: '## 乙', dimension: 'analysis', goal: '分析章节' },
        { heading: '## 甲', dimension: 'facts', goal: '事实章节' },
      ],
    },
    { structure_mode: 'free' },
  )

  assert.deepEqual(briefs.map((brief) => brief.heading), ['## 甲', '## 乙', '## 丙'])
  assert.equal(briefs[0].dimension, 'facts')
  assert.equal(briefs[1].dimension, 'analysis')
  // 丙 has no matching brief -> fallback brief with empty dimension.
  assert.equal(briefs[2].dimension, '')
  assert.ok(briefs[2].goal.length > 0)
})

test('normalizeSectionBriefs (fixed mode) still maps onto required_sections', () => {
  const briefs = normalizeSectionBriefs(
    { section_briefs: [{ heading: '## 一、发生了什么', goal: 'x' }] },
    { required_sections: ['## 一、发生了什么', '## 二、为什么值得关注'] },
  )

  assert.deepEqual(briefs.map((brief) => brief.heading), ['## 一、发生了什么', '## 二、为什么值得关注'])
})

// --- P1-11: the token ladder must not react to network failures ---

test('isProviderParameterRejection only fires on deterministic request-shape rejections', () => {
  assert.equal(isProviderParameterRejection('Admin text generation failed: 400 max_tokens too high'), true)
  assert.equal(isProviderParameterRejection('Admin text generation failed: 422 invalid body'), true)
  assert.equal(isProviderParameterRejection('This model supports a maximum context of 8192 tokens'), true)
  assert.equal(isProviderParameterRejection('The operation was aborted due to timeout'), false)
  assert.equal(isProviderParameterRejection('fetch failed'), false)
  assert.equal(isProviderParameterRejection('Admin text generation failed: 502 bad gateway'), false)
})

test('callLLM keeps the full token budget when the call times out', async () => {
  const usedMaxTokens = []
  const result = await callLLM('system', 'user', 16384, {
    getToken: async () => 'token',
    sleepImpl: async () => {},
    logger: null,
    generateText: async ({ maxTokens }) => {
      usedMaxTokens.push(maxTokens)
      // A 240s abort means the request never got a verdict. Shrinking max_tokens here made
      // the next attempt more likely to truncate — the exact reverse of the stated intent.
      if (usedMaxTokens.length <= 2) {
        const error = new Error('The operation was aborted due to timeout')
        error.name = 'TimeoutError'
        throw error
      }
      return '{"topic":"AI agents"}'
    },
  })

  assert.deepEqual(result, { topic: 'AI agents' })
  assert.ok(usedMaxTokens.every((value) => value === 16384), `expected all 16384, got ${usedMaxTokens}`)
})

// --- P1-10: LLM output shape validation ---

test('validateOutlinePayload rejects a free-mode outline whose outline field is not an array', () => {
  assert.equal(validateOutlinePayload({ topic: 'x', outline: '## A\n## B' }, { isFreeStructure: true }).ok, false)
  assert.equal(validateOutlinePayload({ topic: 'x', outline: [] }, { isFreeStructure: true }).ok, false)
  assert.equal(validateOutlinePayload({ topic: '', outline: ['## A'] }, { isFreeStructure: true }).ok, false)
  assert.equal(validateOutlinePayload({ topic: 'x', outline: ['## A'] }, { isFreeStructure: true }).ok, true)
  // section_briefs headings are an acceptable substitute for outline.outline.
  assert.equal(
    validateOutlinePayload({ topic: 'x', section_briefs: [{ heading: '## A' }] }, { isFreeStructure: true }).ok,
    true,
  )
})

test('validateArticlePackagePayload and validateSectionPayload catch empty or renamed fields', () => {
  assert.equal(validateArticlePackagePayload({ title: '', summary: 'x' }).ok, false)
  assert.equal(validateArticlePackagePayload({ title: 'a judgment-led title' }).ok, true)

  assert.equal(validateSectionPayload({ body: 'wrong key name, so the section would be empty' }).ok, false)
  assert.equal(validateSectionPayload({ markdown: 'too short' }).ok, false)
  assert.equal(validateSectionPayload({ section_md: 'x'.repeat(60) }).ok, true)
  assert.equal(readSectionMarkdown({ content_md: 'body' }), 'body')
})

test('callLLM retries a structurally wrong payload instead of passing it downstream', async () => {
  let attempts = 0
  const result = await callLLM('system', 'user', 8192, {
    getToken: async () => 'token',
    sleepImpl: async () => {},
    logger: null,
    validate: (payload) => validateOutlinePayload(payload, { isFreeStructure: true }),
    generateText: async () => {
      attempts += 1
      // First attempt returns valid JSON with the wrong shape (outline as a string). That
      // used to flow through, produce content_md === '' and burn the whole repair budget.
      if (attempts === 1) return '{"topic":"AI","outline":"## A\\n## B"}'
      return '{"topic":"AI","outline":["## A","## B","## C"]}'
    },
  })

  assert.deepEqual(result.outline, ['## A', '## B', '## C'])
  assert.equal(attempts, 2)
})

// --- P1-12: 429 is retryable and Retry-After is honoured ---

test('isRetryableHttpStatus includes 429 and 408 alongside 5xx', () => {
  assert.equal(isRetryableHttpStatus(429), true)
  assert.equal(isRetryableHttpStatus(408), true)
  assert.equal(isRetryableHttpStatus(503), true)
  assert.equal(isRetryableHttpStatus(422), false)
  assert.equal(isRetryableHttpStatus(401), false)
})

test('parseRetryAfterMs handles delta-seconds, http-dates and junk', () => {
  assert.equal(parseRetryAfterMs('30'), 30000)
  assert.equal(parseRetryAfterMs(''), 0)
  assert.equal(parseRetryAfterMs('not-a-date'), 0)
  assert.equal(parseRetryAfterMs('99999'), 120000)
  assert.ok(parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString()) > 0)
})

test('sendPublishRequest retries admin rate limiting and waits at least Retry-After', async () => {
  let calls = 0
  const sleeps = []
  const result = await sendPublishRequest({
    url: 'https://blog.example.com/api/admin/posts',
    method: 'POST',
    requestBody: { title: 'x' },
    token: 'token',
    retryDelaysMs: [10, 20, 30],
    sleepImpl: async (ms) => sleeps.push(ms),
    logger: null,
    fetchImpl: async () => {
      calls += 1
      // The admin surface is rate limited at 5/minute, so concurrent workflows hit 429
      // routinely; it used to abort the whole run immediately.
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name) => (name === 'retry-after' ? '2' : null) },
          async text() { return 'rate limited' },
        }
      }
      return { ok: true, status: 200, async json() { return { id: 7 } } }
    },
  })

  assert.deepEqual(result, { ok: true, status: 200, json: { id: 7 } })
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [2000])
})

// --- P1-9 / P2-15: repair must not destroy the article ---

test('ensureSectionHeading keeps a legitimate ### subheading further down the section', () => {
  const markdown = 'The section opens with prose, no heading.\n\n### A legitimate subheading\n\nMore body text.'
  const result = ensureSectionHeading(markdown, '## Chapter A')

  assert.ok(result.startsWith('## Chapter A'))
  assert.ok(result.includes('### A legitimate subheading'), 'a later ### must survive')
  assert.ok(result.includes('The section opens with prose'))
})

test('ensureSectionHeading still replaces a wrong heading on the first line', () => {
  const result = ensureSectionHeading('## Model-invented title\n\nBody.', '## Chapter A')
  assert.equal(result, '## Chapter A\n\nBody.')
})

test('spliceRepairedSections preserves the lede and untouched chapters', () => {
  const original = [
    'An opening paragraph that appears before any heading.',
    '',
    '## Chapter A',
    '',
    'Original body of A.',
    '',
    '## A chapter the model invented',
    '',
    'Not in the heading list, and must not be deleted.',
    '',
    '## Chapter B',
    '',
    'Original body of B.',
  ].join('\n')

  const repaired = spliceRepairedSections(
    original,
    ['## Chapter A', '## Chapter B'],
    new Map([['## Chapter A', '## Chapter A\n\nRepaired body of A, noticeably longer.']]),
  )

  assert.ok(repaired.includes('An opening paragraph'), 'the lede must survive repair')
  assert.ok(repaired.includes('Repaired body of A'))
  assert.ok(!repaired.includes('Original body of A'))
  assert.ok(repaired.includes('Not in the heading list'), 'an unmatched chapter must survive')
  assert.ok(repaired.includes('Original body of B'), 'an unrepaired chapter must survive')
})

test('spliceRepairedSections appends a chapter that is missing from the draft', () => {
  const repaired = spliceRepairedSections(
    '## Chapter A\n\nBody of A.',
    ['## Chapter A', '## Chapter B'],
    new Map([['## Chapter B', '## Chapter B\n\nNewly written body of B.']]),
  )

  assert.ok(repaired.includes('Body of A.'))
  assert.ok(repaired.includes('Newly written body of B.'))
})

// --- P2-15: cluster topic keys must not depend on which item leads ---

test('buildClusterTopicKey is stable when the leading item changes', () => {
  const items = [
    { title: 'OpenAI ships a developer agent', summary: 'agent workflow for coding teams', url: 'https://openai.com/a' },
    { title: 'New OpenAI agent lands', summary: 'the agent targets developer teams', url: 'https://techcrunch.com/b?utm_source=rss' },
  ]

  const forward = buildClusterTopicKey(items)
  const reversed = buildClusterTopicKey([...items].reverse())

  assert.equal(forward, reversed)
  assert.ok(forward.length > 0 && forward.length <= 80)
  // A genuinely different member set is a genuinely different topic.
  assert.notEqual(forward, buildClusterTopicKey([items[0]]))
})

// Deriving the key from the member set is exactly why exact-key matching cannot survive a
// day boundary: tomorrow's cluster for the same story has a different member set, so a
// different key. Cross-day reruns are caught on source-URL overlap instead — see
// tests/topic-dedupe-cross-day.test.mjs. This pins the contract the report consumes.
test('selectTopicsForPublishing reports cross-day skips alongside the same-day key guard', () => {
  const result = selectTopicsForPublishing(
    [
      { topic_key: 'already-today', source_count: 3, score: 3, items: [{ url: 'https://x.com/1' }] },
      {
        topic_key: 'rerun-of-yesterday',
        source_count: 3,
        score: 3,
        items: [{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }, { url: 'https://n.com/1' }],
      },
      { topic_key: 'fresh', source_count: 3, score: 3, items: [{ url: 'https://q.com/1' }, { url: 'https://q.com/2' }] },
    ],
    {
      maxPosts: 2,
      minSourcesPerTopic: 2,
      publishedTopicKeys: new Set(['already-today', 'published-but-not-a-candidate-today']),
      publishedTopicFingerprints: [
        {
          slug: 'ai-brief-2026-04-15-y',
          coverage_date: '2026-04-15',
          topic_key: 'yesterday-key',
          source_urls: new Set(['https://a.com/1', 'https://a.com/2', 'https://a.com/3']),
        },
      ],
    },
  )

  assert.deepEqual(result.queue.map((topic) => topic.topic_key), ['fresh'])
  assert.deepEqual(result.skipped_topics.map((entry) => entry.topic_key), ['already-today', 'rerun-of-yesterday'])
  // Published keys this run never saw as candidates still ride along, so the
  // publishing-status report stays complete.
  assert.deepEqual(result.skipped_topic_keys, [
    'already-today',
    'published-but-not-a-candidate-today',
    'rerun-of-yesterday',
  ])
})

// --- P1-5: bridges degrade instead of stranding a published article ---

test('runPublishingBridges records failures without throwing and fills failure_reason', async () => {
  const metadataBridgePayload = buildPublishingMetadataBridgePayload({
    postId: 42,
    post: { slug: 'ai-brief-2026-04-16-x', title: 'T', summary: 'S', content_md: 'body' },
    outline: { topic: 'topic', thesis: 'thesis' },
    metadata: { content_type: 'daily_brief' },
    gate: { metrics: {} },
    config: {},
    researchPack: { sources: [] },
    imagePlans: [],
    workflowKey: 'daily_auto',
    coverageDate: '2026-04-16',
  })

  const calls = []
  const failures = await runPublishingBridges('token', {
    metadataBridgePayload,
    qualitySnapshotPayload: { post_id: 42 },
    topicMetadataPayload: { post_id: 42 },
  }, {
    bridgeMetadataImpl: async () => { calls.push('metadata') },
    bridgeQualityImpl: async () => { calls.push('quality'); throw new Error('502 bad gateway') },
    bridgeTopicImpl: async () => { calls.push('topic') },
    logger: null,
  })

  // The quality bridge blew up, but the other two still ran and nothing was thrown, so the
  // caller can still flip is_published to true.
  assert.deepEqual(calls, ['metadata', 'quality', 'topic'])
  assert.equal(failures.length, 1)
  assert.match(failures[0], /^quality_snapshot:/)
  assert.match(metadataBridgePayload.publishing_artifact.failure_reason, /quality_snapshot:.*502/)
})

test('buildPublishingMetadataBridgePayload leaves failure_reason empty on a clean run', () => {
  const payload = buildPublishingMetadataBridgePayload({
    postId: 1,
    post: { slug: 's', title: 'T', summary: 'S', content_md: 'body' },
    outline: {},
    metadata: { content_type: 'daily_brief' },
    gate: { metrics: {} },
    config: {},
    researchPack: { sources: [] },
    imagePlans: [],
    workflowKey: 'daily_auto',
    coverageDate: '2026-04-16',
  })

  assert.equal(payload.publishing_artifact.failure_reason, '')
})

// --- P1-4: topic-scoped failures must be skippable ---

test('isSkippableTopicError covers quality-gate failures and tagged topic errors', () => {
  assert.equal(isSkippableTopicError(new Error('Quality gate failed after repair attempts: chars:10<4200')), true)
  assert.equal(isSkippableTopicError(createSkippableTopicError('LLM output missing title or content_md')), true)
  assert.equal(isSkippableTopicError(new Error('Publish failed: 500')), false)
})

// --- P1-6: the cost of a dry run must be documented on the CLI ---

test('parseCliArgs exposes --help and the help text states the dry-run LLM cost', () => {
  assert.equal(parseCliArgs(['--help']).help, true)
  assert.equal(parseCliArgs([]).help, false)
  assert.match(AUTO_BLOG_CLI_HELP, /COST WARNING/)
  assert.match(AUTO_BLOG_CLI_HELP, /ai-text\/generate/)
})
