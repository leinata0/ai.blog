import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react'

import AuthLayout from '../components/AuthLayout'
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget'
import { useUser } from '../contexts/UserContext'

const inputClass = 'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }

function maskEmail(value) {
  const [name = '', domain = ''] = value.trim().split('@')
  if (!name || !domain) return ''
  const visible = name.slice(0, Math.min(2, name.length))
  return `${visible}${'*'.repeat(Math.max(2, Math.min(5, name.length - visible.length)))}@${domain}`
}

export default function LoginPage() {
  const navigate = useNavigate()
  const userAuth = useUser()
  const passwordLogin = userAuth.loginWithPassword || userAuth.login
  const codeLogin = userAuth.loginWithCode
  const requestLoginCode = userAuth.requestLoginCode
  const [mode, setMode] = useState('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)

  const handleVerify = useCallback((token) => setTurnstileToken(token), [])

  useEffect(() => {
    if (!cooldown) return undefined
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  function switchMode(nextMode) {
    setMode(nextMode)
    setError('')
    setMessage('')
    setCode('')
  }

  async function handleSendCode() {
    setError('')
    setMessage('')
    if (!email.trim()) {
      setError('请先输入邮箱')
      return
    }
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('请先完成人机验证')
      return
    }
    setLoading(true)
    try {
      const result = await requestLoginCode({ email, turnstile_token: turnstileToken })
      setChallengeId(result.challenge_id)
      setCooldown(result.retry_after || 60)
      setTurnstileToken('')
      setTurnstileResetKey((value) => value + 1)
      setMessage(`验证码已发送至 ${maskEmail(email)}，请检查收件箱和垃圾邮件`)
    } catch (submitError) {
      setError(String(submitError?.message || '验证码发送失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    if (mode === 'code' && (!challengeId || code.length !== 6)) {
      setError('请输入 6 位邮箱验证码')
      return
    }
    setLoading(true)
    try {
      if (mode === 'password') {
        await passwordLogin({ email, password, turnstile_token: turnstileToken })
      } else {
        await codeLogin({ email, challenge_id: challengeId, code })
      }
      navigate('/account')
    } catch (submitError) {
      setError(String(submitError?.message || '登录失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="登录你的阅读空间"
      description="用邮箱登录后，可以跨设备同步关注主题、阅读历史、评论和点赞。验证码登录无需记忆密码。"
    >
      <div className="section-kicker"><ShieldCheck size={14} /> 安全登录</div>
      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>欢迎回来</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>仅支持邮箱登录，不收集用户名。</p>

      <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--bg-canvas)' }}>
        {[
          ['password', '密码登录'],
          ['code', '验证码登录'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => switchMode(value)}
            aria-pressed={mode === value}
            className="rounded-md px-3 py-2.5 text-sm font-semibold transition-colors"
            style={{ backgroundColor: mode === value ? 'var(--bg-surface)' : 'transparent', color: mode === value ? 'var(--accent)' : 'var(--text-tertiary)' }}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="login-email" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
          <div className="relative">
            <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass} pl-11`} style={inputStyle} placeholder="you@example.com" autoComplete="email" required />
          </div>
        </div>

        {mode === 'password' ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>密码</label>
              <Link to="/forgot-password" className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>忘记密码？</Link>
            </div>
            <div className="relative">
              <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-11`} style={inputStyle} placeholder="请输入密码" autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-faint)' }} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-code" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱验证码</label>
              <button type="button" onClick={handleSendCode} disabled={loading || cooldown > 0} className="min-w-20 text-right text-xs font-semibold disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
            <input id="login-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className={inputClass} style={inputStyle} placeholder="输入 6 位验证码" autoComplete="one-time-code" />
            <p className="text-xs leading-5" style={{ color: 'var(--text-faint)' }}>验证码 10 分钟内有效。未注册邮箱验证成功后会自动创建账号。</p>
          </div>
        )}

        <TurnstileWidget onVerify={handleVerify} resetKey={turnstileResetKey} />
        {error ? <div role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: '#ef4444' }}>{error}</div> : null}
        {message ? <div role="status" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>{message}</div> : null}

        <button type="submit" disabled={loading} className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {loading ? '处理中...' : mode === 'password' ? '登录' : '使用验证码登录'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        还没有账号？ <Link to="/register" className="font-semibold" style={{ color: 'var(--accent)' }}>注册邮箱账号</Link>
      </p>
    </AuthLayout>
  )
}
