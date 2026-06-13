import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLLMMaxTokenAttempts,
  callLLM,
  loginAdminWithRetry,
  parseJsonFromLlm,
  normalizeArticleCoverPromptResult,
  assessResearchPackSourceSupport,
  buildTopicKey,
  clusterResearchItemsByTopic,
  createDailyBriefFormatProfile,
  filterItemsForCoverageWindow,
  normalizeOutlineHeadings,
  normalizeSectionBriefs,
  parseCliArgs,
  pickPostCountForRun,
  selectTopicsForPublishing,
  sendPublishRequest,
} from '../auto-blog.mjs'

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

test('normalizeArticleCoverPromptResult appends avoid guidance', () => {
  const prompt = normalizeArticleCoverPromptResult({
    prompt: 'Documentary editorial photograph of a quiet insurance operations room, paper claims folders and a single illuminated risk map, warm neutral palette, wide website cover composition.',
    avoid: ['generic glowing AI brain', 'blue-purple cyberpunk', 'humanoid robot'],
  })

  assert.match(prompt, /Documentary editorial photograph/)
  assert.match(prompt, /Avoid generic glowing AI brain, blue-purple cyberpunk, humanoid robot\./)
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
