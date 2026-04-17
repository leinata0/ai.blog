import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, Bell, BookOpenText, Rss, Tag } from 'lucide-react'

import { useSite } from '../contexts/SiteContext'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { proxyImageUrl } from '../utils/proxyImage'

const hoverGlow = {
  y: -6,
  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
}

function SidebarCard({ children, delay = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
      whileHover={hoverGlow}
      className="editorial-panel rounded-[1.8rem] p-6"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      {children}
    </motion.div>
  )
}

function MetricLink({ to, label, value, bordered = false }) {
  const content = (
    <div
      className={`flex-1 rounded-[1.3rem] px-4 py-4 text-center ${bordered ? 'border' : ''}`.trim()}
      style={bordered ? { borderColor: 'var(--border-muted)' } : {}}
    >
      <div className="text-2xl font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text-faint)' }}>
        {label}
      </div>
    </div>
  )

  return to ? (
    <Link to={to} className="flex-1 transition-transform duration-200 hover:-translate-y-0.5">
      {content}
    </Link>
  ) : content
}

export default function Sidebar() {
  const { settings, stats } = useSite()
  const [avatarBroken, setAvatarBroken] = useState(false)

  const name = settings?.author_name || '作者'
  const bio = settings?.bio || '持续整理 AI 消息、产品动向和值得长期追踪的主线。'
  const avatarUrl = settings?.avatar_url || ''
  const githubLink = settings?.github_link || 'https://github.com'
  const announcement = settings?.announcement || '新的日报、周报和主题主线会持续更新在这里。'
  const postCount = stats?.post_count ?? '-'
  const tagCount = stats?.tag_count ?? '-'
  const categoryCount = stats?.category_count ?? '-'

  useEffect(() => {
    setAvatarBroken(false)
  }, [avatarUrl])

  return (
    <aside className="space-y-5">
      <SidebarCard delay={0.08}>
        <div className="flex items-start gap-4">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[1.6rem] border"
            style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-soft)' }}
          >
            {avatarUrl && !avatarBroken ? (
              <img
                src={proxyImageUrl(avatarUrl)}
                alt={name}
                className="h-full w-full object-cover"
                referrerPolicy="no-referrer"
                onError={() => setAvatarBroken(true)}
              />
            ) : (
              <span className="text-3xl">AI</span>
            )}
          </div>

          <div className="min-w-0">
            <div className="section-kicker !mb-2">作者与站点</div>
            <h3 className="font-display text-2xl font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>
              {name}
            </h3>
            <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
              {bio}
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <MetricLink to="/archive" label="文章" value={postCount} bordered />
          <MetricLink to="/tags" label="标签" value={tagCount} bordered />
          <MetricLink label="分类" value={categoryCount} bordered />
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={githubLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: 'var(--accent)', color: '#fff', boxShadow: '0 18px 30px rgba(47,140,255,0.22)' }}
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0C5.373 0 0 5.373 0 12a12 12 0 0 0 8.207 11.387c.6.111.793-.261.793-.578v-2.234c-3.338.726-4.034-1.416-4.034-1.416-.546-1.387-1.333-1.757-1.333-1.757-1.089-.744.083-.729.083-.729 1.205.085 1.84 1.237 1.84 1.237 1.07 1.834 2.807 1.305 3.492.998.107-.776.418-1.305.761-1.604-2.666-.304-5.467-1.334-5.467-5.93 0-1.311.469-2.382 1.236-3.221-.124-.303-.535-1.524.118-3.176 0 0 1.008-.323 3.301 1.23A11.52 11.52 0 0 1 12 6.844c1.02.005 2.047.138 3.006.404 2.291-1.553 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.839 1.235 1.91 1.235 3.22 0 4.61-2.807 5.625-5.48 5.922.43.372.824 1.103.824 2.222v3.293c0 .319.192.69.8.577A12.001 12.001 0 0 0 24 12c0-6.627-5.373-12-12-12Z" />
            </svg>
            GitHub
          </a>

          <a
            href={buildPublicApiUrl('/feed.xml')}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
          >
            <Rss size={16} />
            RSS
          </a>

          <Link
            to="/feeds"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-secondary)' }}
          >
            <Rss size={16} />
            订阅中心
          </Link>
        </div>
      </SidebarCard>

      <SidebarCard delay={0.16}>
        <div className="section-kicker !mb-2">站点公告</div>
        <p className="text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
          {announcement}
        </p>
      </SidebarCard>

      <SidebarCard delay={0.24}>
        <div className="section-kicker !mb-2">快速入口</div>
        <div className="mt-2 space-y-3">
          <Link
            to="/archive"
            className="flex items-center justify-between rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <BookOpenText size={16} style={{ color: 'var(--accent)' }} />
              浏览归档
            </span>
            <ArrowUpRight size={14} style={{ color: 'var(--text-faint)' }} />
          </Link>

          <Link
            to="/tags"
            className="flex items-center justify-between rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <Tag size={16} style={{ color: 'var(--accent)' }} />
              查看标签
            </span>
            <ArrowUpRight size={14} style={{ color: 'var(--text-faint)' }} />
          </Link>

          <Link
            to="/following"
            className="flex items-center justify-between rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <Bell size={16} style={{ color: 'var(--accent)' }} />
              查看追踪
            </span>
            <ArrowUpRight size={14} style={{ color: 'var(--text-faint)' }} />
          </Link>

          <Link
            to="/feeds"
            className="flex items-center justify-between rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <Rss size={16} style={{ color: 'var(--accent)' }} />
              订阅中心
            </span>
            <ArrowUpRight size={14} style={{ color: 'var(--text-faint)' }} />
          </Link>
        </div>
      </SidebarCard>
    </aside>
  )
}
