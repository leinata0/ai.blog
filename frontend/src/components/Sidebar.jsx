import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { apiGet } from '../api/client'

const hoverGlow = {
  y: -5,
  boxShadow: '0 8px 30px rgba(73,177,245,0.12), 0 2px 8px rgba(0,0,0,0.06)',
  transition: { duration: 0.2 },
}

export default function Sidebar() {
  const [settings, setSettings] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    apiGet('/api/settings').then(setSettings).catch(() => {})
    apiGet('/api/stats').then(setStats).catch(() => {})
  }, [])

  const name = settings?.author_name || '极客新生'
  const bio = settings?.bio || ''
  const avatarUrl = settings?.avatar_url || ''
  const githubLink = settings?.github_link || 'https://github.com'
  const announcement = settings?.announcement || ''
  const postCount = stats?.post_count ?? '-'
  const tagCount = stats?.tag_count ?? '-'
  const categoryCount = stats?.category_count ?? '-'

  return (
    <aside className="space-y-6">
      {/* Author Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        whileHover={hoverGlow}
        className="rounded-xl p-8 text-center"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="w-[100px] h-[100px] mx-auto mb-5 rounded-full bg-gradient-to-br from-[#E3F2FD] to-[#BBDEFB] flex items-center justify-center overflow-hidden" style={{ boxShadow: '0 2px 8px var(--accent-border)' }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-5xl">👨‍💻</span>
          )}
        </div>
        <h3 className="font-semibold text-[22px] mb-2" style={{ color: 'var(--text-primary)' }}>{name}</h3>
        <p className="text-[13px] mb-5 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{bio}</p>

        <div className="flex justify-around mb-5">
          <div className="flex-1 py-4">
            <div className="font-bold text-xl" style={{ color: 'var(--text-primary)' }}>{postCount}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>文章</div>
          </div>
          <div className="flex-1 py-4" style={{ borderLeft: '1px solid var(--border-muted)', borderRight: '1px solid var(--border-muted)' }}>
            <div className="font-bold text-xl" style={{ color: 'var(--text-primary)' }}>{tagCount}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>标签</div>
          </div>
          <div className="flex-1 py-4">
            <div className="font-bold text-xl" style={{ color: 'var(--text-primary)' }}>{categoryCount}</div>
            <div className="text-xs" style={{ color: 'var(--text-faint)' }}>分类</div>
          </div>
        </div>

        <motion.a
          href={githubLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3.5 rounded-lg text-[15px] font-medium transition-all duration-200"
          style={{ backgroundColor: 'var(--accent)', color: '#FFFFFF', boxShadow: '0 2px 8px var(--accent-border)' }}
          whileTap={{ scale: 0.95 }}
          whileHover={{ backgroundColor: 'var(--accent-dim)' }}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          GitHub
        </motion.a>

        <div className="flex items-center justify-center gap-4 mt-5">
          <svg className="w-5 h-5" style={{ color: 'var(--text-faint)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          <svg className="w-5 h-5" style={{ color: 'var(--text-faint)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 5c7.18 0 13 5.82 13 13M6 11a7 7 0 017 7m-6 0a1 1 0 11-2 0 1 1 0 012 0z" /></svg>
        </div>
      </motion.div>

      {/* Announcement */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
        whileHover={hoverGlow}
        className="rounded-xl p-6"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">📢</span>
          <h4 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>公告</h4>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          {announcement}
        </p>
      </motion.div>
    </aside>
  )
}
