import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

import { verifyEmail } from '../api/user'
import { useUser } from '../contexts/UserContext'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const { refresh } = useUser()
  const [status, setStatus] = useState('pending') // pending | success | error
  const [message, setMessage] = useState('')

  useEffect(() => {
    document.title = '邮箱验证 - AI 资讯观察'
    const token = params.get('token')
    if (!token) {
      setStatus('error')
      setMessage('缺少验证令牌，请从邮件中的链接进入。')
      return
    }
    let ignore = false
    verifyEmail(token)
      .then(() => {
        if (ignore) return
        setStatus('success')
        setMessage('邮箱验证成功，现在可以评论和点赞了。')
        refresh().catch(() => {})
      })
      .catch((err) => {
        if (ignore) return
        setStatus('error')
        setMessage(String(err?.message || '验证链接无效或已过期。'))
      })
    return () => {
      ignore = true
    }
  }, [params, refresh])

  return (
    <main className="relative flex min-h-screen items-center justify-center" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <div
        className="w-full max-w-sm space-y-5 rounded-xl p-8 text-center"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex justify-center">
          {status === 'pending' && <Loader2 size={40} className="animate-spin" style={{ color: 'var(--accent)' }} />}
          {status === 'success' && <CheckCircle2 size={40} style={{ color: '#16a34a' }} />}
          {status === 'error' && <XCircle size={40} style={{ color: '#ef4444' }} />}
        </div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {status === 'pending' ? '正在验证邮箱...' : status === 'success' ? '验证成功' : '验证失败'}
        </h1>
        {message ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        ) : null}
        {status !== 'pending' ? (
          <div className="flex justify-center gap-3 pt-2">
            <Link to="/account" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>个人中心</Link>
            <Link to="/" className="text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>返回首页</Link>
          </div>
        ) : null}
      </div>
    </main>
  )
}
