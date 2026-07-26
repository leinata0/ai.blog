import { Component } from 'react'

export const APP_ERROR_EVENT = 'blog:app-error'
const CHUNK_RELOAD_KEY = 'blog.chunk-reload-at'
const CHUNK_RELOAD_COOLDOWN_MS = 60000

// Vite/Rollup surface a dynamic-import failure with several different wordings
// depending on browser. The site redeploys daily, so an open tab clicking any
// lazy route after a deploy hits exactly this.
const CHUNK_ERROR_PATTERN = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|dynamically imported module|chunkloaderror|loading chunk \S+ failed/i

export function isChunkLoadError(error) {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  return CHUNK_ERROR_PATTERN.test(String(error.message || error))
}

export function reloadOnceForStaleChunk() {
  if (typeof window === 'undefined') return false
  try {
    const last = Number(window.sessionStorage?.getItem(CHUNK_RELOAD_KEY) || 0)
    if (Number.isFinite(last) && Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false
    window.sessionStorage?.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    // sessionStorage can be unavailable (privacy mode); fall through to the message.
    return false
  }
  window.location.reload()
  return true
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, staleChunk: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, staleChunk: isChunkLoadError(error) }
  }

  componentDidCatch(error, errorInfo) {
    // Report: console keeps it visible in the browser, the event gives telemetry a hook.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, errorInfo?.componentStack || '')
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(APP_ERROR_EVENT, {
        detail: {
          message: String(error?.message || error || ''),
          componentStack: errorInfo?.componentStack || '',
          staleChunk: isChunkLoadError(error),
        },
      }))
    }

    // A stale chunk is not a real fault: the bundle on disk simply moved. Reload once
    // (rate-limited so a genuinely broken deploy can't turn into a reload loop).
    if (isChunkLoadError(error)) reloadOnceForStaleChunk()
  }

  componentDidUpdate(prevProps) {
    if (!this.state.hasError) return
    const previous = prevProps.resetKeys
    const next = this.props.resetKeys
    if (!Array.isArray(previous) || !Array.isArray(next)) return
    if (previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))) return
    // Navigating away from the broken route must not stay stuck on the error screen.
    this.setState({ hasError: false, error: null, staleChunk: false })
  }

  render() {
    if (this.state.hasError) {
      const description = this.state.staleChunk
        ? '站点刚刚更新过，这个页面的资源已经不是最新版本了。刷新一下就能继续阅读。'
        : '这个页面在加载时出了点问题，刷新通常就能恢复。如果一直失败，可以稍后再来看看。'

      return (
        <div
          className="min-h-screen flex items-center justify-center px-6"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          <div
            className="rounded-xl p-10 text-center max-w-md"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <div className="text-5xl mb-4" aria-hidden="true">⚠️</div>
            <h1 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
              页面出了点问题
            </h1>
            {/* 原始报错基本都是英文技术信息（Failed to fetch dynamically imported module…），
                不展示给读者，只走 console / APP_ERROR_EVENT。 */}
            <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
              {description}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 rounded-lg text-sm font-medium"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              刷新页面
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
