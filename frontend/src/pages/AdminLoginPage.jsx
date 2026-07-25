import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Eye, EyeOff, ShieldCheck } from 'lucide-react'

import { adminLogin } from '../api/admin'
import { setToken } from '../api/auth'
import { AdminEyebrow, AdminField, AdminLiveNotice } from '../components/admin/adminUi'
import '../styles/operations.css'

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

  useEffect(() => {
    document.title = '管理员登录 · Signal Desk Operations'
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await adminLogin(username, password)
      setToken(data.access_token)
      navigate('/admin/dashboard', { replace: true })
    } catch (submitError) {
      setError(resolveLoginErrorMessage(submitError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="ops-auth" data-ui="admin-login">
      <section className="ops-auth__brief" aria-labelledby="ops-auth-brief-title">
        <div className="ops-brand">
          <span className="ops-brand__mark" aria-hidden="true"><span /></span>
          <div>
            <strong>SIGNAL DESK</strong>
            <small>OPERATIONS / SECURE CHANNEL</small>
          </div>
        </div>
        <div className="ops-auth__brief-copy">
          <AdminEyebrow>EDITORIAL INTELLIGENCE SYSTEM</AdminEyebrow>
          <p id="ops-auth-brief-title" className="ops-auth__statement">
            让每一条信号，抵达正确的位置。
          </p>
          <p>
            内容、质量与发布运行在同一个运营坐标系中。此入口仅面向获授权的编辑与系统管理员。
          </p>
        </div>
        <div className="ops-auth__metrics" aria-label="系统安全状态">
          <div><strong>JWT</strong><span>加密会话</span></div>
          <div><strong>TLS</strong><span>安全传输</span></div>
          <div><strong>LIVE</strong><span>运营通道</span></div>
        </div>
      </section>

      <section className="ops-auth__form-column" aria-labelledby="admin-login-title">
        <Link to="/" className="ops-auth__back">
          <ArrowLeft size={15} />
          返回公开站
        </Link>

        <div className="ops-auth__card">
          <header className="ops-auth__card-header">
            <AdminEyebrow>AUTHORIZED ACCESS</AdminEyebrow>
            <h1 id="admin-login-title">进入运营驾驶舱</h1>
            <p>使用管理员凭据继续。登录状态仅保存在当前设备。</p>
          </header>

          <AdminLiveNotice error={error} />

          <form onSubmit={handleSubmit} className="ops-auth__form" aria-busy={loading}>
            <AdminField label="管理员用户名" htmlFor="admin-username">
              <span className="ops-auth__input-wrap">
                <input
                  id="admin-username"
                  name="username"
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  spellCheck={false}
                  required
                  disabled={loading}
                />
              </span>
            </AdminField>

            <AdminField label="密码" htmlFor="admin-password">
              <span className="ops-auth__input-wrap ops-auth__input-wrap--password">
                <input
                  id="admin-password"
                  name="password"
                  aria-label="密码"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="ops-auth__password-toggle"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                  disabled={loading}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </AdminField>

            <button type="submit" disabled={loading} className="ops-auth__submit" aria-label="登录">
              <span>{loading ? '正在验证…' : '验证并进入'}</span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </form>

          <p className="ops-auth__security">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>连续失败可能触发服务端限流。请勿在共享设备保存管理员凭据。</span>
          </p>
        </div>
      </section>
    </main>
  )
}
