import test from 'node:test'
import assert from 'node:assert/strict'

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '..', 'config', 'auto-blog.config.json')

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))

function hostOf(value) {
  return new URL(String(value)).hostname.replace(/^www\./i, '').toLowerCase()
}

// `auto-blog.mjs` keys source diversity (candidate_cap_per_source) and the
// "非官方来源数" statistic on feed.source_group. A duplicated feed url, or the same
// blog registered twice under two different source_group spellings, silently doubles
// how much one publisher can contribute and inflates the unique-source count that
// topic ranking and the quality gate depend on. These assertions lock that down.
test('rss_feeds urls are unique', () => {
  const feeds = config.rss_feeds || []
  const seen = new Map()
  const duplicates = []
  for (const feed of feeds) {
    const url = String(feed.url || '').trim()
    if (seen.has(url)) duplicates.push(url)
    seen.set(url, feed)
  }

  assert.deepEqual(duplicates, [], `duplicate rss_feeds urls: ${duplicates.join(', ')}`)
  assert.ok(feeds.length > 0)
})

test('rss_feeds source_group is consistent per feed host', () => {
  const byHost = new Map()
  for (const feed of config.rss_feeds || []) {
    const host = hostOf(feed.url)
    const group = String(feed.source_group || '').trim()
    if (!byHost.has(host)) byHost.set(host, new Set())
    byHost.get(host).add(group)
  }

  const conflicts = [...byHost.entries()]
    .filter(([, groups]) => groups.size > 1)
    .map(([host, groups]) => `${host}: ${[...groups].join(' vs ')}`)

  assert.deepEqual(conflicts, [], `one host mapped to multiple source_group values -> ${conflicts.join('; ')}`)
})

test('every rss feed declares a non-empty source_group and channel_bucket', () => {
  const missing = (config.rss_feeds || [])
    .filter((feed) => !String(feed.source_group || '').trim() || !String(feed.channel_bucket || '').trim())
    .map((feed) => feed.url)

  assert.deepEqual(missing, [])
})

test('rss feed channel_bucket values stay inside the diversity bucket order', () => {
  const allowed = new Set(config.source_diversity?.preferred_bucket_order || [])
  const unknown = [...new Set((config.rss_feeds || [])
    .map((feed) => String(feed.channel_bucket || '').trim())
    .filter((bucket) => bucket && !allowed.has(bucket)))]

  // An unknown bucket is not rejected by the code, it just sinks to the end of the
  // interleave order — which is a silent ranking change, so it must be deliberate.
  assert.deepEqual(unknown, [], `channel_bucket values missing from preferred_bucket_order: ${unknown.join(', ')}`)
})

test('blogwatcher_sources feed urls are unique and agree with rss_feeds source_group', () => {
  const sources = config.blogwatcher_sources || []
  const seen = new Set()
  const duplicates = []
  for (const source of sources) {
    const url = String(source.feed_url || '').trim()
    if (seen.has(url)) duplicates.push(url)
    seen.add(url)
  }
  assert.deepEqual(duplicates, [], `duplicate blogwatcher_sources feed_url: ${duplicates.join(', ')}`)

  const rssGroupByHost = new Map(
    (config.rss_feeds || []).map((feed) => [hostOf(feed.url), String(feed.source_group || '').trim()])
  )
  const mismatches = sources
    .map((source) => ({
      host: hostOf(source.feed_url),
      group: String(source.source_group || '').trim(),
    }))
    .filter(({ host, group }) => rssGroupByHost.has(host) && rssGroupByHost.get(host) !== group)
    .map(({ host, group }) => `${host}: blogwatcher=${group} rss=${rssGroupByHost.get(host)}`)

  assert.deepEqual(mismatches, [], `source_group drift between rss_feeds and blogwatcher_sources -> ${mismatches.join('; ')}`)
})

test('daily/weekly mode config carries the values the code reads', () => {
  // P2-14: code-side fallbacks were drifting from the config file. These keys must exist
  // so the fallback branch is never the effective value in production.
  for (const modeKey of ['daily_auto', 'daily_manual']) {
    const mode = config[modeKey] || {}
    assert.ok(Number(mode.lookback_hours) > 0, `${modeKey}.lookback_hours`)
    assert.ok(Number(mode.max_candidate_items) > 0, `${modeKey}.max_candidate_items`)
    assert.ok(Number(mode.min_sources_per_topic) > 0, `${modeKey}.min_sources_per_topic`)
    assert.ok(Number(mode.section_target_chars) > 0, `${modeKey}.section_target_chars`)
  }

  const weekly = config.weekly_review || {}
  assert.ok(Number(weekly.target_min_chars) > 0)
  assert.ok(Number(weekly.section_target_chars) > 0)
  assert.ok(Number(weekly.base_enrich_limit) > 0)
  assert.ok(Number(weekly.base_material_cap) > 0)
})
