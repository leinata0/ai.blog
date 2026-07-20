import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  generatePostCoverViaAdminJob,
  generateSeriesCoverViaAdminJob,
  generateSiteHeroViaAdminJob,
  generateTopicCoverViaAdminJob,
  imageGenerationJobImageUrl,
  imageGenerationJobSucceeded,
} from '../lib/admin-image-generation.mjs'

test('generatePostCoverViaAdminJob submits post cover job to admin API', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 42,
          job_id: 42,
          job_type: 'post_cover',
          target_id: 7,
          status: 'succeeded',
          result_image_url: 'https://cdn.example.com/cover.png',
        }
      },
    }
  }

  try {
    const job = await generatePostCoverViaAdminJob({
      blogApiBase: 'https://blog.example.com/',
      token: 'admin-token',
      postId: 7,
      coverBrief: 'Agent tool permissions collide with deployment speed.',
      overwrite: true,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://blog.example.com/api/admin/posts/7/generate-cover')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-token')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      prompt: null,
      cover_brief: 'Agent tool permissions collide with deployment speed.',
      overwrite: true,
      mode: 'apply',
    })
    assert.equal(imageGenerationJobSucceeded(job), true)
    assert.equal(imageGenerationJobImageUrl(job), 'https://cdn.example.com/cover.png')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('configured image channel helper maps every cover target to its admin endpoint', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) })
    return {
      ok: true,
      status: 200,
      async json() {
        return { id: calls.length, status: 'succeeded', result_image_url: `https://cdn.example.com/${calls.length}.png` }
      },
    }
  }

  try {
    const common = { blogApiBase: 'https://blog.example.com', token: 'admin-token', prompt: 'editorial cover' }
    await generateSeriesCoverViaAdminJob({ ...common, targetId: 3, overwrite: true })
    await generateTopicCoverViaAdminJob({ ...common, targetId: 4 })
    await generateSiteHeroViaAdminJob({ ...common, overwrite: true })

    assert.deepEqual(calls.map((call) => call.url), [
      'https://blog.example.com/api/admin/series/3/generate-cover',
      'https://blog.example.com/api/admin/topic-profiles/4/generate-cover',
      'https://blog.example.com/api/admin/settings/generate-hero',
    ])
    assert.equal(calls[0].body.mode, 'apply')
    assert.equal(calls[1].body.mode, 'apply')
    assert.equal('mode' in calls[2].body, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cover automation scripts never bypass the configured image channel', async () => {
  const paths = [
    '../publish-content-file.mjs',
    '../backfill-series-covers.mjs',
    '../backfill-topic-profiles.mjs',
    '../generate-site-hero.mjs',
  ]
  const sources = await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), 'utf8')))

  for (const source of sources) {
    assert.equal(source.includes('api.x.ai/v1/images'), false)
    assert.equal(source.includes('XAI_API_KEY'), false)
    assert.match(source, /generate(?:Post|Series|Topic|Site).+ViaAdminJob/)
  }
})
