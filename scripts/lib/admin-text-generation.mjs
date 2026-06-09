const DEFAULT_TEXT_GENERATION_TIMEOUT_MS = 180000

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

async function parseErrorBody(response) {
  try {
    const raw = (await response.text()).slice(0, 2000)
    try {
      const data = JSON.parse(raw)
      const detail = data?.detail
      if (detail && typeof detail === 'object') {
        const message = String(detail.message || '').trim()
        const code = String(detail.error_code || data?.code || '').trim()
        const attempts = Array.isArray(detail.attempts) ? detail.attempts : []
        const attemptSummary = attempts
          .map((attempt) => {
            const model = String(attempt?.model || '').trim()
            const source = String(attempt?.api_key_source || attempt?.provider || '').trim()
            const attemptMessage = String(attempt?.message || attempt?.error_code || '').trim()
            return [model, source, attemptMessage].filter(Boolean).join(': ')
          })
          .filter(Boolean)
          .slice(0, 5)
          .join(' | ')
        return [message, code && `code=${code}`, attemptSummary && `attempts=${attemptSummary}`]
          .filter(Boolean)
          .join('; ')
          .slice(0, 1000)
      }
      if (typeof detail === 'string') return detail.slice(0, 1000)
    } catch {
      // Fall through to returning the raw response body.
    }
    return raw.slice(0, 1000)
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
