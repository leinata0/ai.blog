import { useEffect, useRef } from 'react'

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
    script.onerror = () => reject(new Error('Failed to load Turnstile'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget. When VITE_TURNSTILE_SITE_KEY is unset (local/dev),
 * it renders nothing and is treated as "passed" — the parent should not gate on
 * a token in that case. Reports the token via onVerify(token).
 */
export default function TurnstileWidget({ onVerify }) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)

  useEffect(() => {
    if (!SITE_KEY) return undefined
    let cancelled = false

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
      .catch(() => {})

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // ignore
        }
      }
    }
  }, [onVerify])

  if (!SITE_KEY) return null
  return <div ref={containerRef} className="flex justify-center" />
}

export const TURNSTILE_ENABLED = Boolean(SITE_KEY)
