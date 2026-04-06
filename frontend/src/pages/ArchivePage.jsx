import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calendar, FileText } from 'lucide-react'
import { fetchArchive } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

export default function ArchivePage() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '归档 - 极客开发日志'
    fetchArchive()
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const totalPosts = groups.reduce((acc, g) => acc + g.posts.length, 0)

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />

      <div className="mx-auto max-w-3xl px-6 sm:px-10 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            文章归档
          </h1>
          <p className="text-sm mb-12" style={{ color: 'var(--text-faint)' }}>
            <FileText size={14} className="inline mr-1" />
            共 {totalPosts} 篇文章
          </p>
        </motion.div>

        {loading ? (
          <div className="space-y-8">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton-pulse">
                <div className="h-8 w-20 rounded mb-4" style={{ background: 'var(--bg-surface)' }} />
                <div className="space-y-3 ml-6">
                  <div className="h-5 w-3/4 rounded" style={{ background: 'var(--bg-surface)' }} />
                  <div className="h-5 w-2/3 rounded" style={{ background: 'var(--bg-surface)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>暂无文章</p>
        ) : (
          <div className="space-y-12">
            {groups.map((group, gi) => (
              <motion.div
                key={group.year}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.1, duration: 0.4 }}
              >
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-3" style={{ color: 'var(--text-primary)' }}>
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                  {group.year}
                  <span className="text-sm font-normal" style={{ color: 'var(--text-faint)' }}>
                    ({group.posts.length} 篇)
                  </span>
                </h2>

                <div className="ml-1.5 border-l-2 pl-8 space-y-4" style={{ borderColor: 'var(--border-muted)' }}>
                  {group.posts.map((post, pi) => (
                    <motion.div
                      key={post.slug}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: gi * 0.1 + pi * 0.05 }}
                      className="relative group"
                    >
                      <div
                        className="absolute -left-[2.35rem] top-2 w-2.5 h-2.5 rounded-full border-2 transition-colors duration-200"
                        style={{
                          borderColor: 'var(--accent)',
                          backgroundColor: 'var(--bg-canvas)',
                        }}
                      />
                      <Link
                        to={`/posts/${post.slug}`}
                        className="flex items-baseline gap-4 py-2 transition-colors duration-200 group-hover:text-[var(--accent)]"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <span className="text-xs flex-shrink-0 flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                          <Calendar size={12} />
                          {formatDate(post.created_at)}
                        </span>
                        <span className="font-medium text-[15px] group-hover:text-[var(--accent)] transition-colors duration-200" style={{ color: 'var(--text-primary)' }}>
                          {post.title}
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
