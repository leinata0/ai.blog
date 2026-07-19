import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthLayout from '../components/AuthLayout'
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget'
import { useUser } from '../contexts/UserContext'

const inputClass = 'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { resetPassword, requestPasswordReset } = useUser()
  const [email, setEmail] = useState(params.get('email') || '')
  const [challengeId, setChallengeId] = useState(params.get('challenge') || '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [token, setToken] = useState('')
  const [cooldown, setCooldown] = useState(() => (params.get('challenge') ? 60 : 0))
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [message, setMessage] = useState(() => (params.get('challenge') ? '验证码已发送，请查收邮箱' : '请重新发送验证码'))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setEmail(params.get('email') || '')
    setChallengeId(params.get('challenge') || '')
  }, [params])

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function resend() {
    setError('')
    if (!email.trim()) {
      setError('请先输入邮箱')
      return
    }
    if (TURNSTILE_ENABLED && !token) {
      setError('请先完成人机验证')
      return
    }
    setLoading(true)
    try {
      const result = await requestPasswordReset({ email, turnstile_token: token })
      setChallengeId(result.challenge_id)
      setParams({ email, challenge: result.challenge_id })
      setCooldown(result.retry_after || 60)
      setToken('')
      setTurnstileResetKey((value) => value + 1)
      setMessage('新的验证码已发送')
    } catch (submitError) {
      setError(String(submitError?.message || '发送失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!challengeId) {
      setError('重置链接已失效，请重新申请验证码')
      return
    }
    if (password.length < 8 || password !== confirmation) {
      setError(password.length < 8 ? '新密码至少 8 位' : '两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      await resetPassword({ email, challenge_id: challengeId, code, new_password: password, turnstile_token: token })
      navigate('/account')
    } catch (submitError) {
      setError(String(submitError?.message || '重置失败，请检查验证码'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="设置一个新的密码" description="验证码只使用一次。重置成功后，其他设备上的旧登录状态会被撤销。">
      <div className="section-kicker">安全恢复</div>
      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>重置密码</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>{message}</p>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="reset-email" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
          <input id="reset-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} style={inputStyle} autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reset-code" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>验证码</label>
          <div className="flex gap-2">
            <input id="reset-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className={inputClass} style={inputStyle} placeholder="6 位验证码" required />
            <button type="button" onClick={resend} disabled={loading || cooldown > 0} className="w-24 shrink-0 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border-muted)', color: 'var(--accent)' }}>{cooldown > 0 ? `${cooldown}s 后重发` : '重新发送'}</button>
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reset-password" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>新密码</label>
          <input id="reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} style={inputStyle} placeholder="至少 8 位" autoComplete="new-password" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reset-confirmation" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>确认新密码</label>
          <input id="reset-confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className={inputClass} style={inputStyle} placeholder="再次输入新密码" autoComplete="new-password" required />
        </div>
        <TurnstileWidget onVerify={setToken} resetKey={turnstileResetKey} />
        {error ? <div role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: '#ef4444' }}>{error}</div> : null}
        <button type="submit" disabled={loading} className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {loading ? '保存中...' : '设置新密码并登录'}
        </button>
      </form>
      <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}><Link to="/login" className="font-semibold" style={{ color: 'var(--accent)' }}>返回登录</Link></p>
    </AuthLayout>
  )
}
