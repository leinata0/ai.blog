import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function AuthLayout({ title, eyebrow = 'AI 资讯观察', description, children }) {
  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] lg:px-12">
        <section className="hidden lg:block">
          <Link to="/" className="inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-faint)' }}>
            <ArrowLeft size={15} /> 返回首页
          </Link>
          <div className="mt-16 max-w-xl">
            <div className="section-kicker"><ShieldCheck size={14} /> {eyebrow}</div>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-8" style={{ color: 'var(--text-secondary)' }}>
              {description}
            </p>
          </div>
        </section>

        <section className="w-full">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-sm lg:hidden" style={{ color: 'var(--text-faint)' }}>
            <ArrowLeft size={15} /> 返回首页
          </Link>
          <div className="rounded-lg border px-6 py-7 sm:px-8" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}>
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}
