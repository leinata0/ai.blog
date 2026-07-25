import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

import AuthLayout from '../components/AuthLayout'
import { verifyEmail } from '../api/user'
import { useUser } from '../contexts/UserContext'

export default function VerifyEmailPage() {
  const [params] = useSearchParams()
  const { refresh } = useUser()
  const [status, setStatus] = useState('pending') // pending | success | error
  const [message, setMessage] = useState('')

  useEffect(() => {
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
    <AuthLayout
      title="确认你的邮箱"
      description="我们正在核对邮件中的一次性验证信号。此过程不会读取你的邮件内容。"
      documentTitle="邮箱验证"
    >
      <div className="space-y-5 py-2 text-center" aria-live="polite" aria-busy={status === 'pending'}>
        <div className="flex justify-center">
          {status === 'pending' ? <Loader2 size={40} className="animate-spin" aria-hidden="true" style={{ color: 'var(--accent)' }} /> : null}
          {status === 'success' ? <CheckCircle2 size={40} aria-hidden="true" style={{ color: '#16a34a' }} /> : null}
          {status === 'error' ? <XCircle size={40} aria-hidden="true" style={{ color: '#ef4444' }} /> : null}
        </div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {status === 'pending' ? '正在验证邮箱…' : status === 'success' ? '验证成功' : '验证失败'}
        </h2>
        {message ? (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        ) : null}
        {status !== 'pending' ? (
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link to="/account" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>个人中心</Link>
            <Link to="/" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold" style={{ color: 'var(--text-tertiary)' }}>返回首页</Link>
          </div>
        ) : null}
      </div>
    </AuthLayout>
  )
}
