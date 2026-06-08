const DEFAULT_TEXT_GENERATION_TIMEOUT_MS = 180000

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

async function parseErrorBody(response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

export async function generateTextViaAdminApi({
  blogApiBase,
  token,
  messages,
  maxTokens = null,
  temperature = null,
  jsonMode = false,
  timeoutMs = DEFAULT_TEXT_GENERATION_TIMEOUT_MS,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Missing text generation messages')
  }

  const response = await fetch(`${base}/api/admin/ai-text/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages: messages.map((message) => ({
        role: String(message?.role || '').trim(),
        content: String(message?.content || '').trim(),
      })),
      max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : null,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : null,
      json_mode: Boolean(jsonMode),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Admin text generation failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }

  const data = await response.json()
  const content = String(data?.content || '').trim()
  if (!content) throw new Error('Admin text generation returned empty content')
  return content
}
