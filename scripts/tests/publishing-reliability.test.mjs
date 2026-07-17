import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  bridgePublishingMetadata,
  bridgeQualitySnapshot,
  bridgeTopicMetadata,
  fetchPublishedTopicKeys,
} from '../auto-blog.mjs'
import { findPostByExactSlug, publishArticle } from '../publish-article.mjs'

function jsonResponse(body, { ok = true, status = 200, text = '' } = {}) {
  return {
    ok,
    status,
    async json() { return body },
    async text() { return text },
  }
}

test('fetchPublishedTopicKeys only includes posts from the requested coverage date', async () => {
  const keys = await fetchPublishedTopicKeys({
    coverageDate: '2026-07-17',
    fetchImpl: async () => jsonResponse({
      items: [
        { topic_key: 'today-explicit', slug: 'unrelated', coverage_date: '2026-07-17' },
        { topic_key: 'yesterday-explicit', slug: 'unrelated', coverage_date: '2026-07-16' },
        { topic_key: 'missing-date', slug: 'unrelated' },
        { slug: 'ai-brief-2026-07-17-legacy-today', coverage_date: '2026-07-17' },
        { slug: 'ai-brief-2026-07-17-legacy-old-row', coverage_date: '2026-07-16' },
        { slug: 'ai-brief-2026-07-16-legacy-yesterday', coverage_date: '2026-07-17' },
      ],
    }),
  })

  assert.deepEqual([...keys].sort(), ['legacy-today', 'today-explicit'])
})

test('publishing bridges propagate write failures and reject missing post ids', async () => {
  const bridgeFailure = new Error('bridge storage unavailable')
  const failingUpsert = async () => { throw bridgeFailure }

  await assert.rejects(
    bridgePublishingMetadata('token', { post_id: 42 }, { upsert: failingUpsert }),
    /bridge storage unavailable/
  )
  await assert.rejects(
    bridgeQualitySnapshot('token', { post_id: 42 }, { upsert: failingUpsert }),
    /bridge storage unavailable/
  )
  await assert.rejects(
    bridgeTopicMetadata('token', { post_id: 42 }, { upsert: failingUpsert }),
    /bridge storage unavailable/
  )
  await assert.rejects(bridgeQualitySnapshot('token', {}), /missing post_id/)
  await assert.rejects(bridgeTopicMetadata('token', {}), /missing post_id/)
})

test('findPostByExactSlug scans pages and returns only an exact slug match', async () => {
  const requestedPages = []
  const post = await findPostByExactSlug({
    slug: 'target-slug',
    token: 'token',
    blogApiBase: 'https://blog.example',
    pageSize: 2,
    fetchImpl: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      requestedPages.push(page)
      return page === 1
        ? jsonResponse({ total: 3, items: [{ id: 1, slug: 'target-slug-extra' }, { id: 2, slug: 'other' }] })
        : jsonResponse({ total: 3, items: [{ id: 17, slug: 'target-slug' }] })
    },
  })

  assert.equal(post.id, 17)
  assert.deepEqual(requestedPages, [1, 2])
})

test('findPostByExactSlug rejects missing and duplicate targets', async () => {
  await assert.rejects(
    findPostByExactSlug({
      slug: 'missing',
      token: 'token',
      fetchImpl: async () => jsonResponse({ total: 1, items: [{ id: 1, slug: 'other' }] }),
    }),
    /Post not found for exact slug: missing/
  )

  await assert.rejects(
    findPostByExactSlug({
      slug: 'duplicate',
      token: 'token',
      fetchImpl: async () => jsonResponse({
        total: 2,
        items: [{ id: 1, slug: 'duplicate' }, { id: 2, slug: 'duplicate' }],
      }),
    }),
    /Multiple posts found for exact slug: duplicate/
  )
})

test('publishArticle updates the id resolved from the exact slug', async () => {
  const requests = []
  await publishArticle({
    slug: 'target-slug',
    contentMd: 'replacement body',
    blogApiBase: 'https://blog.example',
    username: 'admin',
    password: 'secret',
    logger: { log() {} },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options })
      if (url.endsWith('/api/admin/login')) return jsonResponse({ access_token: 'token' })
      if (url.includes('/api/admin/posts?')) {
        return jsonResponse({ total: 1, items: [{ id: 91, slug: 'target-slug' }] })
      }
      if (url.endsWith('/api/admin/posts/91')) return jsonResponse({ id: 91 })
      throw new Error(`Unexpected request: ${url}`)
    },
  })

  assert.match(requests[1].url, /page_size=50/)
  assert.equal(requests.at(-1).url, 'https://blog.example/api/admin/posts/91')
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { content_md: 'replacement body' })
})

test('publishArticle propagates login and update failures', async () => {
  await assert.rejects(
    publishArticle({
      password: 'secret',
      logger: { log() {} },
      fetchImpl: async () => jsonResponse({}, { ok: false, status: 401, text: 'bad credentials' }),
    }),
    /Admin login failed: 401 bad credentials/
  )

  await assert.rejects(
    publishArticle({
      slug: 'target-slug',
      password: 'secret',
      logger: { log() {} },
      fetchImpl: async (url) => {
        if (url.endsWith('/api/admin/login')) return jsonResponse({ access_token: 'token' })
        if (url.includes('/api/admin/posts?')) {
          return jsonResponse({ total: 1, items: [{ id: 91, slug: 'target-slug' }] })
        }
        return jsonResponse({}, { ok: false, status: 503, text: 'database unavailable' })
      },
    }),
    /Post update failed: 503 database unavailable/
  )
})

test('publish-article CLI exits nonzero when publishing fails', () => {
  const scriptPath = fileURLToPath(new URL('../publish-article.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ADMIN_PASSWORD: '',
      DEV_ADMIN_PASSWORD: '',
    },
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Missing ADMIN_PASSWORD/)
})
