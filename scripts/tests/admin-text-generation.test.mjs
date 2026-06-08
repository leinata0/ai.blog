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
