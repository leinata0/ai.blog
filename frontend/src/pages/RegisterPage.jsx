import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Eye, EyeOff } from 'lucide-react'

import AuthLayout from '../components/AuthLayout'
import TurnstileWidget, { TURNSTILE_ENABLED } from '../components/TurnstileWidget'
import { useUser } from '../contexts/UserContext'

const inputClass = 'w-full rounded-lg border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]'
const inputStyle = { backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useUser()
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const strength = useMemo(() => {
    let score = 0
    if (password.length >= 8) score += 1
    if (/[A-Za-z]/.test(password) && /\d/.test(password)) score += 1
    if (/[^A-Za-z0-9]/.test(password) || password.length >= 12) score += 1
    return score
  }, [password])
  const handleVerify = useCallback((token) => setTurnstileToken(token), [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('请先完成人机验证')
      return
    }
    setLoading(true)
    try {
      await register({ email, password, nickname: nickname || undefined, turnstile_token: turnstileToken })
      navigate('/account')
    } catch (submitError) {
      setError(String(submitError?.message || '注册失败，请稍后重试'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="建立你的阅读档案" description="注册后可同步关注、历史、评论和点赞。邮箱是唯一登录标识，昵称仅用于公开互动展示。">
      <div className="section-kicker">邮箱账号</div>
      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>创建账号</h2>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="reg-email" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>邮箱</label>
          <input id="reg-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} style={inputStyle} placeholder="you@example.com" autoComplete="email" required />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reg-nickname" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>昵称（可选）</label>
          <input id="reg-nickname" type="text" value={nickname} onChange={(event) => setNickname(event.target.value)} className={inputClass} style={inputStyle} placeholder="留空则用邮箱前缀" maxLength={50} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="reg-password" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>密码</label>
          <div className="relative">
            <input id="reg-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} className={`${inputClass} pr-11`} style={inputStyle} placeholder="至少 8 位" autoComplete="new-password" required />
            <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1" style={{ color: 'var(--text-faint)' }} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5" aria-label={`密码强度 ${strength}/3`}>
            {[1, 2, 3].map((item) => <span key={item} className="h-1 rounded-full" style={{ backgroundColor: strength >= item ? 'var(--accent)' : 'var(--border-muted)' }} />)}
          </div>
          <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-faint)' }}><Check size={12} /> 建议混合字母、数字，避免复用其他网站密码</p>
        </div>
        <TurnstileWidget onVerify={handleVerify} />
        {error ? <div role="alert" className="rounded-lg px-4 py-3 text-sm" style={{ backgroundColor: 'var(--danger-soft)', border: '1px solid var(--danger-border)', color: '#ef4444' }}>{error}</div> : null}
        <button type="submit" disabled={loading} className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>{loading ? '注册中...' : '注册'}</button>
      </form>
      <div className="mt-6 space-y-2 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
        <p>已有账号？ <Link to="/login" className="font-semibold" style={{ color: 'var(--accent)' }}>登录</Link></p>
        <p>不想设置密码？ <Link to="/login" className="font-semibold" style={{ color: 'var(--accent)' }}>使用邮箱验证码</Link></p>
      </div>
    </AuthLayout>
  )
}
