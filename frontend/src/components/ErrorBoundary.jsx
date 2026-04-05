import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex items-center justify-center px-6"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          <div
            className="rounded-xl p-10 text-center max-w-md"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
          >
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
              页面出了点问题
            </h1>
            <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <button
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
