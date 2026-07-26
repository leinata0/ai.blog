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
  waitForImageGenerationJob,
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

test('waitForImageGenerationJob polls an injected fetch until the job is terminal', async () => {
  const statuses = ['queued', 'running', 'succeeded']
  const polls = []
  const sleeps = []

  const job = await waitForImageGenerationJob({
    blogApiBase: 'https://blog.example.com',
    token: 'admin-token',
    jobId: 11,
    initialJob: { job_id: 11, status: 'queued' },
    intervalMs: 1234,
    requestTimeoutMs: 9000,
    sleepImpl: async (ms) => sleeps.push(ms),
    fetchImpl: async (url, options) => {
      polls.push({ url: String(url), options })
      const status = statuses[polls.length] || 'succeeded'
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            job_id: 11,
            status,
            result_image_url: status === 'succeeded' ? 'https://cdn.example.com/done.png' : '',
          }
        },
      }
    },
  })

  assert.equal(job.status, 'succeeded')
  assert.equal(imageGenerationJobImageUrl(job), 'https://cdn.example.com/done.png')
  assert.equal(polls.length, 2)
  assert.equal(polls[0].url, 'https://blog.example.com/api/admin/image-generation-jobs/11')
  assert.deepEqual(sleeps, [1234, 1234])
})

test('waitForImageGenerationJob returns a poll_timeout job instead of throwing', async () => {
  const job = await waitForImageGenerationJob({
    blogApiBase: 'https://blog.example.com',
    token: 'admin-token',
    jobId: 12,
    initialJob: { job_id: 12, status: 'running' },
    intervalMs: 15,
    timeoutMs: 20,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { job_id: 12, status: 'running' }
      },
    }),
  })

  // The frontend job store keys off this exact error_code; keep it stable.
  assert.equal(job.error_code, 'poll_timeout')
  assert.equal(job.status, 'running')
  assert.equal(job.job_id, 12)
  assert.match(job.error, /still running/)
  assert.equal(imageGenerationJobSucceeded(job), false)
})

test('combined helpers keep submit and poll timeouts independent', async () => {
  const timeouts = []
  const originalTimeout = AbortSignal.timeout
  AbortSignal.timeout = (ms) => {
    timeouts.push(ms)
    return originalTimeout.call(AbortSignal, ms)
  }

  try {
    await generatePostCoverViaAdminJob({
      blogApiBase: 'https://blog.example.com',
      token: 'admin-token',
      postId: 5,
      submitTimeoutMs: 45000,
      pollTimeoutMs: 180000,
      pollIntervalMs: 1,
      requestTimeoutMs: 11000,
      sleepImpl: async () => {},
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return String(url).includes('/image-generation-jobs/')
            ? { job_id: 9, status: 'succeeded', result_image_url: 'https://cdn.example.com/x.png' }
            : { job_id: 9, status: 'queued' }
        },
      }),
    })
  } finally {
    AbortSignal.timeout = originalTimeout
  }

  // Submit uses submitTimeoutMs; the status GET uses requestTimeoutMs, never pollTimeoutMs.
  assert.deepEqual(timeouts, [45000, 11000])
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
