import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget'
import { useUser } from '../contexts/UserContext'

const inputClass = 'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const { requestPasswordReset } = useUser()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (TURNSTILE_ENABLED && !token) {
      setError('请先完成人机验证')
      return
    }
    setLoading(true)
    try {
      const result = await requestPasswordReset({ email, turnstile_token: token })
      navigate(`/reset-password?email=${encodeURIComponent(email.trim())}&challenge=${encodeURIComponent(result.challenge_id)}`)
    } catch (submitError) {
      setError(String(submitError?.message || '请求失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="找回你的账号" description="输入注册邮箱，我们会发送一次性验证码。整个过程不会显示该邮箱是否已注册。">
      <div className="section-kicker">账号恢复</div>
      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>找回密码</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>验证码有效期 10 分钟，验证后可以设置新密码。</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="forgot-email" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
          <input id="forgot-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} style={inputStyle} placeholder="you@example.com" autoComplete="email" required />
        </div>
        <TurnstileWidget onVerify={setToken} />
        {error ? <div role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: '#ef4444' }}>{error}</div> : null}
        <button type="submit" disabled={loading} className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {loading ? '发送中...' : '发送重置验证码'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        想起密码了？ <Link to="/login" className="font-semibold" style={{ color: 'var(--accent)' }}>返回登录</Link>
      </p>
    </AuthLayout>
  )
}
