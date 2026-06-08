import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generatePostCoverViaAdminJob,
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
      prompt: 'editorial AI cover',
      overwrite: true,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://blog.example.com/api/admin/posts/7/generate-cover')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-token')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      prompt: 'editorial AI cover',
      overwrite: true,
      mode: 'apply',
    })
    assert.equal(imageGenerationJobSucceeded(job), true)
    assert.equal(imageGenerationJobImageUrl(job), 'https://cdn.example.com/cover.png')
  } finally {
    globalThis.fetch = originalFetch
  }
})
