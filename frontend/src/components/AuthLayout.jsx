import { useEffect } from 'react'
import { ArrowLeft, CheckCircle2, Radio, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

const TRUST_SIGNALS = [
  '登录状态与管理端完全隔离',
  '邮箱不会在公开页面展示',
  '随时可以撤销其他设备会话',
]

export default function AuthLayout({
  title,
  eyebrow = 'Signal Desk Identity',
  description,
  children,
  documentTitle = title,
}) {
  useEffect(() => {
    document.title = `${documentTitle} - AI 资讯观察`
  }, [documentTitle])

  return (
    <main
      className="auth-shell min-h-screen"
      data-ui="auth-layout"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <div className="mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(23rem,30rem)] lg:gap-16 lg:px-14 lg:py-12">
        <section className="flex flex-col lg:min-h-[39rem] lg:justify-between">
          <div className="flex items-center justify-between">
            <Link to="/" className="auth-brand-mark" aria-label="Signal Desk 首页">
              Signal Desk
            </Link>
            <span className="hidden items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] sm:inline-flex" style={{ color: 'var(--text-faint)' }}>
              <Radio size={13} aria-hidden="true" />
              Identity online
            </span>
          </div>
          <div className="mt-10 max-w-2xl lg:mt-0 lg:pb-8">
            <div className="section-kicker"><ShieldCheck size={14} aria-hidden="true" /> {eyebrow}</div>
            <h1 className="mt-4 max-w-xl font-display text-3xl font-semibold leading-[1.1] sm:text-4xl lg:mt-6 lg:text-5xl xl:text-6xl" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 sm:text-base lg:mt-6 lg:leading-8" style={{ color: 'var(--text-secondary)' }}>
              {description}
            </p>
            <ul className="mt-7 hidden gap-3 sm:grid lg:mt-9" aria-label="账号安全说明">
              {TRUST_SIGNALS.map((signal) => (
                <li key={signal} className="flex items-center gap-3 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  <CheckCircle2 size={16} aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  {signal}
                </li>
              ))}
            </ul>
          </div>
          <p className="hidden text-xs uppercase tracking-[0.18em] lg:block" style={{ color: 'var(--text-faint)' }}>
            Editorial intelligence · Personal context
          </p>
        </section>

        <section className="w-full self-center">
          <div className="auth-card rounded-[1.4rem] border px-5 py-6 sm:px-8 sm:py-8">
            {children}
          </div>
          <Link to="/" className="mx-auto mt-6 flex min-h-11 w-fit items-center gap-2 px-3 text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>
            <ArrowLeft size={15} aria-hidden="true" /> 返回今日 AI 信号台
          </Link>
        </section>
      </div>
    </main>
  )
}
