import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  collectStoredTopicProfileKeys,
  parseBackfillTopicArgs,
  runBackfillTopicProfiles,
} from '../backfill-topic-profiles.mjs'
import { parseBackfillArgs } from '../backfill-quality-snapshots.mjs'
import { parseSeriesCoverArgs, runBackfillSeriesCovers } from '../backfill-series-covers.mjs'
import { assertPublishArticleArgs, parsePublishArticleArgs } from '../publish-article.mjs'
import { resolveArticleFileUrl } from '../publish-content-file.mjs'

// P0-2: `scripts/` had two opposite conventions — repair-post-media.mjs required --apply
// while all three backfill scripts wrote by default. A bare `node backfill-*.mjs` therefore
// mutated whatever BLOG_API_BASE pointed at (production, in CI).

test('every backfill script defaults to a dry run and needs --apply to write', () => {
  assert.equal(parseBackfillTopicArgs([]).dryRun, true)
  assert.equal(parseBackfillArgs([]).dryRun, true)
  assert.equal(parseSeriesCoverArgs([]).dryRun, true)

  assert.equal(parseBackfillTopicArgs(['--apply']).dryRun, false)
  assert.equal(parseBackfillArgs(['--apply']).dryRun, false)
  assert.equal(parseSeriesCoverArgs(['--apply']).dryRun, false)

  // --dry-run stays accepted and still wins when passed after --apply.
  assert.equal(parseSeriesCoverArgs(['--apply', '--dry-run']).dryRun, true)
})

// The other half of the same contract. Flipping the scripts to dry-run-by-default is only
// safe if the dispatchers that drive them were taught to ask for a write. Both backfill
// workflows only ever appended `--dry-run`, so after the default flipped a manual dispatch
// with dry_run=false silently became a dry run that still reported success — the failure
// mode is invisible, so it gets a test rather than a comment.
test('backfill workflows pass --apply when the operator asks for a real run', () => {
  for (const workflow of ['backfill-quality-snapshots.yml', 'backfill-series-covers.yml']) {
    const yaml = readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8')
    const gate = yaml.match(/if \[ "\$DISPATCH_DRY_RUN" = "true" \]; then args\+=\(--dry-run\); (.*?)fi/)
    assert.ok(gate, `${workflow} must gate --dry-run on the dry_run input`)
    assert.match(
      gate[1],
      /else args\+=\(--apply\);\s*/,
      `${workflow} must append --apply when dry_run is false, or the run is a silent no-op`,
    )
  }
})

// P0-1: existence was probed with GET /api/admin/posts/{id}/topic-metadata, a route the
// backend only registers for PUT. Every probe 405'd, the helper returned null, and the
// "skip when a profile exists" branch was permanently dead — every run overwrote everything.

test('collectStoredTopicProfileKeys only counts persisted profiles, not virtual ones', () => {
  const keys = collectStoredTopicProfileKeys([
    { topic_key: 'stored-a', profile_exists: true, is_virtual: false },
    { topic_key: 'virtual-b', profile_exists: false, is_virtual: true },
    { topic_key: 'legacy-c' },
    { topic_key: '   ' },
  ])

  assert.deepEqual([...keys].sort(), ['legacy-c', 'stored-a'])
})

test('runBackfillTopicProfiles skips posts whose topic profile already exists', async () => {
  const upserts = []
  const report = await runBackfillTopicProfiles({
    dryRun: false,
    limit: 10,
    maxPages: 1,
    logger: null,
    getAdminTokenImpl: async () => 'token',
    loadConfigImpl: async () => ({ topic_presentation: { enabled: false, rules: [], default_presentation: {} } }),
    fetchStoredTopicProfileKeysImpl: async () => new Set(['already-there']),
    fetchAdminPostsImpl: async () => ([
      { id: 1, title: 'Existing', topic_key: 'already-there', content_type: 'daily_brief' },
      { id: 2, title: 'New', topic_key: 'brand-new', content_type: 'daily_brief' },
      { id: 3, title: 'No topic key' },
    ]),
    upsertTopicProfileImpl: async (_token, payload) => {
      upserts.push(payload.post_id)
      return { ok: true, data: { profile_id: 7 } }
    },
  })

  assert.deepEqual(upserts, [2], 'only the post without a stored profile may be written')
  assert.equal(report.items[0].status, 'skipped_existing')
  assert.equal(report.items[1].status, 'updated')
  assert.equal(report.items[2].status, 'skipped_missing_topic_key')
})

test('runBackfillTopicProfiles fetches the existence list once, not once per post', async () => {
  let listCalls = 0
  await runBackfillTopicProfiles({
    dryRun: true,
    limit: 10,
    maxPages: 1,
    logger: null,
    getAdminTokenImpl: async () => 'token',
    loadConfigImpl: async () => ({ topic_presentation: { enabled: false, rules: [], default_presentation: {} } }),
    fetchStoredTopicProfileKeysImpl: async () => { listCalls += 1; return new Set() },
    fetchAdminPostsImpl: async () => ([
      { id: 1, title: 'A', topic_key: 'a' },
      { id: 2, title: 'B', topic_key: 'b' },
    ]),
    upsertTopicProfileImpl: async () => { throw new Error('dry run must not write') },
  })

  assert.equal(listCalls, 1)
})

test('series cover backfill generates nothing in dry-run mode', async () => {
  let generated = 0
  const report = await runBackfillSeriesCovers({
    logger: null,
    loginImpl: async () => 'token',
    fetchSeriesListImpl: async () => ([
      { id: 1, slug: 'has-cover', cover_image: 'https://cdn.example/a.png' },
      { id: 2, slug: 'needs-cover', cover_image: '' },
    ]),
    generateSeriesCoverImpl: async () => { generated += 1; return 'https://cdn.example/new.png' },
  })

  // dryRun defaults to true, and image generation is billed per image.
  assert.equal(report.dry_run, true)
  assert.equal(generated, 0)
  assert.equal(report.items[0].status, 'skipped_existing')
  assert.equal(report.items[1].status, 'dry_run')
})

// P0-3: publish-article.mjs carried a hard-coded slug plus a hard-coded article body, so a
// bare invocation overwrote one specific live post.

test('publish-article CLI refuses to run without an explicit slug and content file', () => {
  assert.equal(parsePublishArticleArgs([]).dryRun, true)
  assert.throws(() => assertPublishArticleArgs({ slug: '', file: 'body.md' }), /Missing --slug/)
  assert.throws(() => assertPublishArticleArgs({ slug: 'a-slug', file: '' }), /Missing --file/)

  const parsed = parsePublishArticleArgs(['--slug', 'a-slug', '--file=body.md', '--apply'])
  assert.deepEqual(assertPublishArticleArgs(parsed), { slug: 'a-slug', file: 'body.md', dryRun: false })
})

// P2-15: `new URL('C:\\tmp\\a.mjs', import.meta.url)` eats \t and \a and yields "c:mpa.mjs".

test('resolveArticleFileUrl handles Windows absolute paths without mangling escapes', () => {
  const url = resolveArticleFileUrl('C:\\tmp\\article.mjs')
  assert.match(url.href, /^file:\/\/\//)
  assert.match(decodeURIComponent(url.pathname), /\/tmp\/article\.mjs$/i)

  const relative = resolveArticleFileUrl('./content/x.mjs', 'C:\\repo\\scripts')
  assert.match(decodeURIComponent(relative.pathname), /\/repo\/scripts\/content\/x\.mjs$/i)
})
