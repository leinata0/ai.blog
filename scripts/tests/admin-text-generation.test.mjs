import assert from 'node:assert/strict'
import test from 'node:test'

import { generateTextViaAdminApi } from '../lib/admin-text-generation.mjs'

test('generateTextViaAdminApi sends messages to admin text endpoint', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          content: '{"title":"ok"}',
          provider: 'siliconflow',
          model: 'deepseek-ai/DeepSeek-V3',
          purpose: 'text_generation',
        }
      },
    }
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
    })

    assert.equal(content, '{"title":"ok"}')
    assert.equal(calls.length, 1)
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
