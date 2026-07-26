import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Eye, EyeOff, Mail, ShieldCheck } from 'lucide-react'

import AuthLayout from '../components/AuthLayout'
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget'
import { useUser } from '../contexts/UserContext'

const inputClass = 'auth-input w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }

function maskEmail(value) {
  const [name = '', domain = ''] = value.trim().split('@')
  if (!name || !domain) return ''
  const visible = name.slice(0, Math.min(2, name.length))
  return `${visible}${'*'.repeat(Math.max(2, Math.min(5, name.length - visible.length)))}@${domain}`
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const sessionNotice = searchParams.get('reason') === 'sessions-revoked'
    ? '所有设备均已安全退出，请重新登录。'
    : ''

  const mountedRef = useRef(true)

  const handleVerify = useCallback((token) => setTurnstileToken(token), [])

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  // 依赖倒计时秒数会让 interval 每秒销毁重建并逐渐漂移；
  // 这里只依赖冷却截止时间戳，单个 interval 从时间戳反推剩余秒数。
  useEffect(() => {
    if (!cooldownUntil) return undefined

    function tick() {
      const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
      setCooldown(remaining)
      if (remaining === 0) setCooldownUntil(0)
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  const startCooldown = useCallback((seconds) => {
    const parsed = Number(seconds)
    const safeSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 60
    setCooldown(safeSeconds)
    setCooldownUntil(Date.now() + safeSeconds * 1000)
  }, [])

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
      if (!mountedRef.current) return
      setChallengeId(result.challenge_id)
      startCooldown(result.retry_after)
      setTurnstileToken('')
      setTurnstileResetKey((value) => value + 1)
      setMessage(`验证码已发送至 ${maskEmail(email)}，请检查收件箱和垃圾邮件`)
    } catch (submitError) {
      if (mountedRef.current) setError(String(submitError?.message || '验证码发送失败，请稍后重试'))
    } finally {
      if (mountedRef.current) setLoading(false)
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
      navigate('/account?tab=overview')
    } catch (submitError) {
      if (mountedRef.current) setError(String(submitError?.message || '登录失败，请稍后重试'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="登录你的阅读空间"
      description="用邮箱登录后，可以跨设备同步关注主题、阅读历史、评论和点赞。验证码登录无需记忆密码。"
      documentTitle="登录"
    >
      <div className="section-kicker"><ShieldCheck size={14} /> 安全登录</div>
      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>欢迎回来</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-tertiary)' }}>仅支持邮箱登录，不收集用户名。</p>
      {sessionNotice ? <div role="status" className="mt-4 rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>{sessionNotice}</div> : null}

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
            className="min-h-11 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors"
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
            <input id="login-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={`${inputClass} pl-11`} style={inputStyle} placeholder="you@example.com" autoComplete="email" spellCheck={false} required />
          </div>
        </div>

        {mode === 'password' ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-password" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>密码</label>
              <Link to="/forgot-password" className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>忘记密码？</Link>
            </div>
            <div className="relative">
              <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-11`} style={inputStyle} placeholder="请输入密码" autoComplete="current-password" required />
              <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg" style={{ color: 'var(--text-faint)' }} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="login-code" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱验证码</label>
              <button type="button" onClick={handleSendCode} disabled={loading || cooldown > 0} className="min-h-11 min-w-20 text-right text-xs font-semibold disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </button>
            </div>
            <input id="login-code" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className={inputClass} style={inputStyle} placeholder="输入 6 位验证码" autoComplete="one-time-code" spellCheck={false} />
            <p className="text-xs leading-5" style={{ color: 'var(--text-faint)' }}>验证码 10 分钟内有效。未注册邮箱验证成功后会自动创建账号。</p>
          </div>
        )}

        <TurnstileWidget onVerify={handleVerify} resetKey={turnstileResetKey} />
        {error ? <div role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: 'var(--danger-text)' }}>{error}</div> : null}
        {message ? <div role="status" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>{message}</div> : null}

        <button type="submit" disabled={loading} className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {loading ? '处理中…' : mode === 'password' ? '登录' : '使用验证码登录'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        还没有账号？ <Link to="/register" className="font-semibold" style={{ color: 'var(--accent)' }}>注册邮箱账号</Link>
      </p>
    </AuthLayout>
  )
}
