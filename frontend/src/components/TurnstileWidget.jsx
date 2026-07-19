import { useEffect, useRef, useState } from 'react'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

let scriptPromise = null

function loadTurnstileScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      scriptPromise = null
      reject(new Error('Failed to load Turnstile'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget. When VITE_TURNSTILE_SITE_KEY is unset (local/dev),
 * it renders nothing and is treated as "passed" — the parent should not gate on
 * a token in that case. Reports the token via onVerify(token).
 */
export default function TurnstileWidget({ onVerify, resetKey = 0 }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (!SITE_KEY) return undefined
    let cancelled = false
    setLoadFailed(false)

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token) => onVerify?.(token),
          'expired-callback': () => onVerify?.(''),
          'error-callback': () => onVerify?.(''),
        })
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = null
    }
  }, [loadAttempt, onVerify, resetKey])

  if (!SITE_KEY) return null
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div ref={containerRef} className="flex justify-center" />
      {loadFailed ? (
        <div role="alert" className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>验证服务加载失败</span>
          <button
            type="button"
            className="font-semibold"
            style={{ color: 'var(--accent)' }}
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          >
            重试
          </button>
        </div>
      ) : null}
    </div>
  )
}

export const TURNSTILE_ENABLED = Boolean(SITE_KEY)
