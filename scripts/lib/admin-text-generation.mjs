const DEFAULT_TEXT_GENERATION_TIMEOUT_MS = 240000
const DEFAULT_POLL_INTERVAL_MS = 1500

function trimBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

async function fetchJson(url, { token, method = 'GET', body, timeoutMs } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Admin text generation failed: ${response.status} ${await parseErrorBody(response)}`.trim())
  }
  return response.json()
}

/**
 * Submit admin text generation and poll until the async job completes.
 * Backend returns a job immediately so long LLM calls do not hold HTTP workers.
 */
export async function generateTextViaAdminApi({
  blogApiBase,
  token,
  messages,
  maxTokens = null,
  temperature = null,
  jsonMode = false,
  timeoutMs = DEFAULT_TEXT_GENERATION_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  const base = trimBaseUrl(blogApiBase)
  if (!base) throw new Error('Missing BLOG_API_BASE')
  if (!token) throw new Error('Missing admin token')
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Missing text generation messages')
  }

  const submitPayload = await fetchJson(`${base}/api/admin/ai-text/generate`, {
    token,
    method: 'POST',
    timeoutMs: Math.min(timeoutMs, 60000),
    body: {
      messages: messages.map((message) => ({
        role: String(message?.role || '').trim(),
        content: String(message?.content || '').trim(),
      })),
      max_tokens: Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : null,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : null,
      json_mode: Boolean(jsonMode),
    },
  })

  // Backward-compat: older backends returned content inline without a job.
  if (submitPayload?.content && !submitPayload?.job_id && !submitPayload?.id) {
    return String(submitPayload.content).trim()
  }

  const jobId = submitPayload?.job_id || submitPayload?.id
  if (!jobId) {
    throw new Error('Admin text generation did not return a job id')
  }

  const terminal = new Set(['succeeded', 'failed', 'canceled'])
  const startedAt = Date.now()
  let latest = submitPayload

  while (!terminal.has(String(latest?.status || ''))) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Admin text generation timed out after ${timeoutMs}ms (job ${jobId})`)
    }
    await sleep(pollIntervalMs)
    latest = await fetchJson(`${base}/api/admin/text-generation-jobs/${jobId}`, {
      token,
      method: 'GET',
      timeoutMs: 30000,
    })
  }

  if (latest.status === 'failed' || latest.status === 'canceled') {
    const code = String(latest.error_code || '').trim()
    const message = String(latest.error || '文本生成失败').trim()
    throw new Error(
      `Admin text generation failed: job_${latest.status} ${[message, code && `code=${code}`].filter(Boolean).join('; ')}`.trim(),
    )
  }

  const content = String(latest?.content || '').trim()
  if (!content) throw new Error('Admin text generation returned empty content')
  return content
}
