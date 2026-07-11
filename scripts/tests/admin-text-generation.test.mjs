import assert from 'node:assert/strict'
import test from 'node:test'

import { generateTextViaAdminApi } from '../lib/admin-text-generation.mjs'

test('generateTextViaAdminApi submits job then polls for content', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).endsWith('/api/admin/ai-text/generate')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 42,
            job_id: 42,
            status: 'queued',
            generated: false,
            content: '',
            purpose: 'text_generation',
          }
        },
      }
    }
    if (String(url).endsWith('/api/admin/text-generation-jobs/42')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: 42,
            job_id: 42,
            status: 'succeeded',
            generated: true,
            content: '{"title":"ok"}',
            provider: 'siliconflow',
            model: 'deepseek-ai/DeepSeek-V3',
            purpose: 'text_generation',
          }
        },
      }
    }
    throw new Error(`unexpected url ${url}`)
  }

  try {
    const content = await generateTextViaAdminApi({
      blogApiBase: 'https://blog.example.com/',
      token: 'admin-token',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Build a title.' },
      ],
      maxTokens: 1024,
      temperature: 0.4,
      jsonMode: true,
      pollIntervalMs: 1,
    })

    assert.equal(content, '{"title":"ok"}')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url, 'https://blog.example.com/api/admin/ai-text/generate')
    assert.equal(calls[0].options.method, 'POST')
    assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-token')
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Build a title.' },
      ],
      max_tokens: 1024,
      temperature: 0.4,
      json_mode: true,
    })
    assert.equal(calls[1].url, 'https://blog.example.com/api/admin/text-generation-jobs/42')
    assert.equal(calls[1].options.method, 'GET')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generateTextViaAdminApi formats provider attempts from admin errors', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    async text() {
      return JSON.stringify({
        detail: {
          message: '所有 AI 模型实例均调用失败，请检查服务源、模型和 API Key。',
          error_code: 'all_models_failed',
          attempts: [
            {
              model: 'deepseek-ai/DeepSeek-V3',
              api_key_source: 'stored',
              message: '生文字请求失败，HTTP 401。',
            },
          ],
        },
        code: 'http_400',
        request_id: 'req-test',
      })
    },
  })

  try {
    await assert.rejects(
      generateTextViaAdminApi({
        blogApiBase: 'https://blog.example.com/',
        token: 'admin-token',
        messages: [{ role: 'user', content: 'hello' }],
      }),
      /Admin text generation failed: 400 .*code=all_models_failed.*deepseek-ai\/DeepSeek-V3: stored: 生文字请求失败，HTTP 401。/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generateTextViaAdminApi surfaces failed job errors', async () => {
  const originalFetch = globalThis.fetch
  let poll = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/admin/ai-text/generate')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { id: 7, job_id: 7, status: 'queued', content: '' }
        },
      }
    }
    poll += 1
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 7,
          job_id: 7,
          status: 'failed',
          content: '',
          error: '生文字请求失败，HTTP 401。',
          error_code: 'generation_failed',
        }
      },
    }
  }

  try {
    await assert.rejects(
      generateTextViaAdminApi({
        blogApiBase: 'https://blog.example.com/',
        token: 'admin-token',
        messages: [{ role: 'user', content: 'hello' }],
        pollIntervalMs: 1,
      }),
      /Admin text generation failed: job_failed .*code=generation_failed/,
    )
    assert.equal(poll, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
