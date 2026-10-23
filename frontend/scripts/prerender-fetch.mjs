const FETCH_ATTEMPTS = Math.max(1, Math.min(5, Number.parseInt(process.env.PRERENDER_FETCH_ATTEMPTS || '3', 10) || 3))
const FETCH_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.PRERENDER_FETCH_TIMEOUT_MS || '30000', 10) || 30000)
const MAX_COOLDOWN_MS = 300_000
const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))

class PrerenderCooldownError extends Error {}

export function retryAfterMs(value, nowMs = Date.now()) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const delay = Number(text) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  const date = /[a-z]/i.test(text) ? Date.parse(text) : NaN
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null
}

// One queue covers bootstrap, every detail category, and every retry. A 429 from
// any in-flight request pauses the whole queue, including newly discovered URLs.
export function createRequestScheduler({ concurrency = 8, intervalMs = 250, nowImpl = Date.now, waitImpl = wait } = {}) {
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1))
  const spacing = Math.max(0, Number(intervalMs) || 0)
  let active = 0
  let nextStart = 0
  let notBefore = 0
  let cooldownSpent = 0
  let fatal = null
  let startQueue = Promise.resolve()
  const slots = []
  const acquire = async () => {
    if (active < limit) active += 1
    else await new Promise((resolve) => slots.push(resolve))
  }
  const release = () => {
    if (slots.length) slots.shift()()
    else active -= 1
  }
  const waitForStart = async () => {
    for (;;) {
      if (fatal) throw fatal
      const delay = Math.max(notBefore, nextStart) - nowImpl()
      if (delay <= 0) break
      await waitImpl(delay)
      // Another response may have extended the cooldown while this timer slept.
    }
    nextStart = nowImpl() + spacing
  }
  return {
    pause(delayMs) {
      const now = nowImpl()
      const extension = Math.max(0, now + delayMs - Math.max(now, notBefore))
      if (delayMs > MAX_COOLDOWN_MS || cooldownSpent + extension > MAX_COOLDOWN_MS) {
        fatal = new PrerenderCooldownError('Upstream Retry-After exceeds the 5 minute prerender retry budget; refusing further requests')
        throw fatal
      }
      cooldownSpent += extension
      notBefore = Math.max(notBefore, now + Math.max(0, delayMs))
    },
    async run(operation) {
      if (fatal) throw fatal
      await acquire()
      try {
        const turn = startQueue.then(waitForStart)
        startQueue = turn.catch(() => {})
        await turn
        return await operation()
      } finally { release() }
    },
  }
}

export async function fetchWithRetry(url, init = {}, {
  attempts = FETCH_ATTEMPTS,
  fetchImpl = fetch,
  waitImpl = wait,
  nowImpl = Date.now,
  randomImpl = Math.random,
  scheduler = null,
} = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let delay = 250 * (2 ** (attempt - 1))
    try {
      const request = async () => {
        const response = await fetchImpl(url, {
          ...init,
          signal: init.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (response.status !== 429 && response.status < 500) return response
        const hint = retryAfterMs(response.headers?.get?.('retry-after'), nowImpl())
        if (response.status === 429 || hint !== null) {
          const cooldown = Math.max(delay, hint ?? 60_000)
          delay = cooldown + Math.min(Math.floor(randomImpl() * 1000), Math.max(0, MAX_COOLDOWN_MS - cooldown))
          // Pause before releasing the concurrency slot, even on the last attempt.
          // Oversized waits fail the queue closed instead of retrying too early.
          try {
            if (delay > MAX_COOLDOWN_MS) {
              scheduler?.pause(delay)
              throw new PrerenderCooldownError('Upstream Retry-After exceeds the 5 minute prerender retry budget')
            }
            scheduler?.pause(delay)
            console.warn(`[prerender] upstream ${response.status}; queue cooldown ${Math.ceil(delay / 1000)}s`)
          } catch (error) {
            await response.body?.cancel?.()
            throw error
          }
        }
        await response.body?.cancel?.()
        throw new Error(`Transient prerender response: ${response.status}`)
      }
      return await (scheduler ? scheduler.run(request) : request())
    } catch (error) {
      if (error instanceof PrerenderCooldownError) throw error
      lastError = error
    }
    if (attempt < attempts) await waitImpl(delay)
  }
  throw lastError || new Error(`Failed to fetch ${url}`)
}
