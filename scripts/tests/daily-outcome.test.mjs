import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { selectTopicsForPublishing, summarizeDailyRunOutcome } from '../auto-blog.mjs'

const topics = ['agents', 'research', 'tools'].map((topic_key) => ({
  topic_key,
  items: [{ url: `https://example.com/${topic_key}` }],
  source_count: 1,
}))

test('an entire daily queue blocked by source requirements is failed, not a healthy no-op', () => {
  const selection = selectTopicsForPublishing(topics, { maxPosts: 1 })
  const outcome = summarizeDailyRunOutcome({
    selection,
    skippedTopics: selection.queue.map((topic) => ({
      topic_key: topic.topic_key,
      reason: 'insufficient_source_support:sources:1<3,domains:1<3',
      status: 'skipped',
    })),
  })
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.published_count, 0)
  assert.equal(outcome.blocked_count, 3)
  assert.deepEqual(outcome.reason_counts, { insufficient_source_support: 3 })
  assert.match(outcome.message, /No posts were produced/)
})

test('all model or quality failures are actionable even though per-topic errors are isolated', () => {
  const outcome = summarizeDailyRunOutcome({
    selection: { queue: topics },
    skippedTopics: [
      { reason: 'topic_failed:all_models_failed', status: 'failed' },
      { reason: 'quality_gate_failed:chars:10<4200', status: 'skipped' },
    ],
  })
  assert.equal(outcome.status, 'failed')
  assert.deepEqual(outcome.reason_counts, { topic_failed: 1, quality_gate_failed: 1 })
})

test('reruns that only encounter already-published topics remain successful no-ops', () => {
  const selection = selectTopicsForPublishing(topics, {
    maxPosts: 1,
    publishedTopicKeys: new Set(topics.map((topic) => topic.topic_key)),
  })
  assert.equal(selection.queue.length, 0)
  assert.equal(summarizeDailyRunOutcome({ selection }).status, 'skipped')
  assert.equal(summarizeDailyRunOutcome({
    selection: { queue: topics },
    skippedTopics: topics.map(() => ({ reason: 'slug already exists' })),
  }).status, 'skipped')
})

test('partial output remains a success and preserves diagnostics for blocked candidates', () => {
  const outcome = summarizeDailyRunOutcome({
    selection: { queue: topics },
    results: [{ post: { slug: 'published-post' } }],
    skippedTopics: [{ reason: 'topic_failed:model unavailable' }],
  })
  assert.equal(outcome.status, 'success')
  assert.equal(outcome.published_count, 1)
  assert.equal(outcome.blocked_count, 1)
})

test('dry-run drafts count as generated output without claiming publication', () => {
  const input = { selection: { queue: topics }, results: [{ post: { slug: 'draft' } }] }
  const dryRun = summarizeDailyRunOutcome({ ...input, dryRun: true })
  assert.equal(dryRun.status, 'success')
  assert.equal(dryRun.generated_count, 1)
  assert.equal(dryRun.published_count, 0)
  assert.match(dryRun.message, /^Drafted 1 post/)
  const live = summarizeDailyRunOutcome(input)
  assert.equal(live.status, dryRun.status)
  assert.equal(live.generated_count, 1)
  assert.equal(live.published_count, 1)
  assert.match(live.message, /^Published 1 post/)
})

test('an outer run error with no output remains failed even with no topic diagnostics', () => {
  const outcome = summarizeDailyRunOutcome({ runFailure: new Error('database unavailable') })
  assert.equal(outcome.status, 'failed')
  assert.match(outcome.message, /database unavailable/)
})

test('the CLI exits nonzero and writes an Actions summary when every dry-run candidate is blocked', async (t) => {
  const taskDir = await mkdtemp(join(tmpdir(), 'ai-blog-outcome-'))
  t.after(() => rm(taskDir, { recursive: true, force: true }))
  const configPath = join(taskDir, 'config.json')
  const preloadPath = join(taskDir, 'fetch.mjs')
  const summaryPath = join(taskDir, 'summary.md')
  const requestsPath = join(taskDir, 'requests.log')
  const articleText = 'Agent evaluation requires reproducible evidence and measured results. '.repeat(8)
  await writeFile(configPath, JSON.stringify({
    rss_feeds: [{ name: 'Fixture', url: 'https://source.example/feed', source_type: 'official_blog' }],
    fallback_urls: [],
    blogwatcher_enabled: false,
    arxiv_enabled: false,
    daily_auto: { min_posts_per_run: 1, max_posts_per_run: 1, skip_published_topic_keys: false },
    quality_gate: { daily_brief: { min_sources: 3, min_high_quality_sources: 2, min_unique_domains: 3 } },
  }))
  // All requests are replaced before the CLI loads. Any attempted login, LLM call,
  // upload, metadata write or deploy hook makes this fixture fail; no network is used.
  await writeFile(preloadPath, `
    import { appendFileSync } from 'node:fs'
    globalThis.fetch = async (url, options = {}) => {
      appendFileSync(process.env.TEST_REQUESTS, (options.method || 'GET') + ' ' + url + '\\n')
      if (options.method && options.method !== 'GET') throw new Error('Unexpected mutation: ' + url)
      if (url === 'https://source.example/feed') return new Response(${JSON.stringify(`<rss version="2.0"><channel><title>Fixture</title><item><title>Agent evaluation workflows</title><link>https://source.example/agent</link><description>${articleText}</description><pubDate>Thu, 22 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`)})
      if (String(url).startsWith('https://r.jina.ai/')) return new Response(${JSON.stringify(articleText)})
      throw new Error('Unexpected request: ' + url)
    }
  `)
  const result = spawnSync(process.execPath, [
    '--import', pathToFileURL(preloadPath).href,
    fileURLToPath(new URL('../auto-blog.mjs', import.meta.url)),
    '--mode', 'daily-auto', '--dry-run', '--coverage-date', '2026-10-22', '--max-posts', '1',
  ], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      ADMIN_PASSWORD: 'fixture-only',
      AUTO_BLOG_CONFIG_PATH: configPath,
      GITHUB_STEP_SUMMARY: summaryPath,
      TEST_REQUESTS: requestsPath,
    },
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /No posts were produced/)
  const summary = await readFile(summaryPath, 'utf8')
  assert.match(summary, /Status: \*\*failed\*\*/)
  assert.match(summary, /insufficient_source_support: 1/)
  assert.match(summary, /dry run; LLM calls are billed/)
  assert.match(summary, /Generated posts \| Published posts/)
  assert.doesNotMatch(await readFile(requestsPath, 'utf8'), /POST|admin|deploy/)
})
