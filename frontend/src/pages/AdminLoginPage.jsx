import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { adminLogin } from '../api/admin'
import { setToken } from '../api/auth'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await adminLogin(username, password)
      setToken(data.access_token)
      navigate('/admin/dashboard')
    } catch {
      setError('用户名或密码错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center relative" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Link
        to="/"
        className="absolute top-6 left-6 flex items-center gap-1.5 text-sm transition-colors duration-200 hover:text-[var(--accent)]"
        style={{ color: 'var(--text-faint)' }}
      >
        <ArrowLeft size={14} /> 返回首页
      </Link>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl p-8 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <h1 className="text-2xl font-bold text-center" style={{ color: 'var(--text-primary)' }}>
          管理员登录
        </h1>

        {error && (
          <div className="flex items-center gap-2 text-sm py-3 px-4 rounded-lg" style={{ backgroundColor: 'var(--danger-soft)', color: '#ef4444', border: '1px solid var(--danger-border)' }}>
            <span>⚠️</span>
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>用户名</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all duration-200"
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
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>密码</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all duration-200"
              style={{
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-muted)',
                color: 'var(--text-primary)',
              }}
              placeholder="••••••"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
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
          className="w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </main>
  )
}
