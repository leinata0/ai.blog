import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'

import { adminLogin } from '../api/admin'
import { setToken } from '../api/auth'

function resolveLoginErrorMessage(error) {
  const message = String(error?.message || '')

  if (message.includes('Invalid credentials')) {
    return '用户名或密码错误'
  }

  if (/failed to fetch|networkerror|load failed|cors|http 5\d\d/i.test(message)) {
    return '登录失败，后台服务暂时不可用，请稍后重试。'
  }

  return '登录失败，请检查服务连接后重试。'
}

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await adminLogin(username, password)
      setToken(data.access_token)
      navigate('/admin/dashboard')
    } catch (submitError) {
      setError(resolveLoginErrorMessage(submitError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Link
        to="/"
        className="absolute left-6 top-6 flex items-center gap-1.5 text-sm transition-colors duration-200 hover:text-[var(--accent)]"
        style={{ color: 'var(--text-faint)' }}
      >
        <ArrowLeft size={14} /> 返回首页
      </Link>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-xl p-8"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h1 className="text-center text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          管理员登录
        </h1>

        {error ? (
          <div
            className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
            style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444', border: '1px solid var(--danger-border)' }}
          >
            <span>!</span>
            {error}
          </div>
        ) : null}

        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }} htmlFor="admin-username">
            用户名
          </label>
          <input
            id="admin-username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all duration-200"
            style={{
              backgroundColor: 'var(--bg-canvas)',
              border: '1px solid var(--border-muted)',
              color: 'var(--text-primary)',
            }}
            placeholder="admin"
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }} htmlFor="admin-password">
            密码
          </label>
          <div className="relative">
            <input
              id="admin-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg px-4 py-2.5 pr-10 text-sm outline-none transition-all duration-200"
              style={{
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-muted)',
                color: 'var(--text-primary)',
              }}
              placeholder="请输入密码"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5"
              style={{ color: 'var(--text-faint)' }}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg py-2.5 text-sm font-medium transition-all duration-200 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </main>
  )
}
