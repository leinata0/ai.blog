import test from 'node:test'
import assert from 'node:assert/strict'

import { parseArxivFeed, resolveArxivPlan, runArxiv } from '../lib/arxiv.mjs'

function atomFeed(entryXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">${entryXml}</feed>`
}

test('parseArxivFeed extracts arxiv entries', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <id>http://arxiv.org/abs/1234.5678v1</id>
      <updated>2026-04-11T00:00:00Z</updated>
      <published>2026-04-10T00:00:00Z</published>
      <title>Efficient Agents at Scale</title>
      <summary>We study agent orchestration.</summary>
      <author><name>Alice</name></author>
      <author><name>Bob</name></author>
      <link href="http://arxiv.org/abs/1234.5678v1" rel="alternate" type="text/html" />
      <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI" />
    </entry>
  </feed>`

  const items = parseArxivFeed(xml)

  assert.equal(items.length, 1)
  assert.equal(items[0].source_type, 'paper')
  assert.equal(items[0].authors.length, 2)
  assert.equal(items[0].primary_category, 'cs.AI')
})

test('parseArxivFeed picks the alternate link when an entry has several <link rel>', () => {
  // Real arXiv entries carry alternate (HTML) + related (PDF) + sometimes DOI links.
  // Reading `entry.link` as a scalar would produce a comma-joined garbage URL.
  const items = parseArxivFeed(atomFeed(`
    <entry>
      <id>http://arxiv.org/abs/2401.00001v1</id>
      <published>2026-04-10T00:00:00Z</published>
      <title>Multi Link Entry</title>
      <summary>Body.</summary>
      <link title="doi" href="http://dx.doi.org/10.0000/x" rel="related" />
      <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1" rel="related" type="application/pdf" />
      <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html" />
    </entry>`))

  assert.equal(items.length, 1)
  assert.equal(items[0].url, 'http://arxiv.org/abs/2401.00001v1')
  assert.equal(items[0].url.includes(','), false)
})

test('parseArxivFeed unwraps elements that carry attributes', () => {
  const items = parseArxivFeed(atomFeed(`
    <entry>
      <id>http://arxiv.org/abs/2401.00002v1</id>
      <published>2026-04-10T00:00:00Z</published>
      <title type="text">Attributed Title</title>
      <summary type="text">Attributed summary.</summary>
      <link href="http://arxiv.org/abs/2401.00002v1" rel="alternate" />
    </entry>`))

  assert.equal(items[0].title, 'Attributed Title')
  assert.equal(items[0].summary, 'Attributed summary.')
  assert.equal(items[0].title.includes('[object Object]'), false)
})

test('runArxiv fetches with a timeout and returns scored papers', async () => {
  const calls = []
  const items = await runArxiv({
    keywords: ['agents'],
    maxPapers: 2,
    minScore: 0.7,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options })
      return {
        ok: true,
        headers: new Headers({ 'content-length': '400' }),
        body: null,
        async text() {
          return atomFeed(`
            <entry>
              <id>http://arxiv.org/abs/2401.00003v1</id>
              <published>2026-04-10T00:00:00Z</published>
              <title>Agents everywhere</title>
              <summary>About agents.</summary>
              <link href="http://arxiv.org/abs/2401.00003v1" rel="alternate" />
            </entry>`)
        },
      }
    },
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].title, 'Agents everywhere')
  assert.equal(calls.length, 1, 'arXiv must be queried sequentially, once per run')
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test('runArxiv refuses an oversized response body', async () => {
  await assert.rejects(
    runArxiv({
      keywords: ['agents'],
      maxResponseBytes: 64,
      fetchImpl: async () => ({
        ok: true,
        headers: new Headers({ 'content-length': '5000000' }),
        body: null,
        async text() {
          throw new Error('body must not be buffered when content-length exceeds the cap')
        },
      }),
    }),
    /arxiv:response_too_large/,
  )
})

test('runArxiv caps a streamed body that lies about its length', async () => {
  const chunk = new TextEncoder().encode('x'.repeat(128))
  await assert.rejects(
    runArxiv({
      keywords: ['agents'],
      maxResponseBytes: 64,
      fetchImpl: async () => ({
        ok: true,
        headers: new Headers(),
        body: {
          getReader() {
            return {
              async read() {
                return { done: false, value: chunk }
              },
              async cancel() {},
            }
          },
        },
      }),
    }),
    /arxiv:response_too_large/,
  )
})

test('resolveArxivPlan enables weekly review overrides only when keywords exist', () => {
  const plan = resolveArxivPlan({
    arxiv_enabled: false,
    arxiv_max_papers: 1,
    weekly_review: {
      arxiv_enabled: true,
      arxiv_optional: true,
      arxiv_max_papers: 3,
      arxiv_min_score: 0.9,
    },
  }, {
    mode: 'weekly-review',
    keywords: ['agents', 'reasoning'],
  })

  assert.equal(plan.mode, 'weekly-review')
  assert.equal(plan.enabled, true)
  assert.equal(plan.optional, true)
  assert.equal(plan.maxPapers, 3)
  assert.equal(plan.minScore, 0.9)
  assert.deepEqual(plan.keywords, ['agents', 'reasoning'])
})

test('resolveArxivPlan disables lookup when no normalized keywords remain', () => {
  const plan = resolveArxivPlan({
    weekly_review: {
      arxiv_enabled: true,
    },
  }, {
    mode: 'weekly-review',
    keywords: ['  ', '\n'],
  })

  assert.equal(plan.enabled, false)
  assert.deepEqual(plan.keywords, [])
})
