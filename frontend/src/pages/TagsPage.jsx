import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Tag } from 'lucide-react'
import { fetchAllTags } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

export default function TagsPage() {
  const [tags, setTags] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '标签 - 极客开发日志'
    fetchAllTags()
      .then(setTags)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxCount = Math.max(1, ...tags.map((t) => t.post_count))

  function getSize(count) {
    const ratio = count / maxCount
    if (ratio > 0.7) return 'text-2xl'
    if (ratio > 0.4) return 'text-xl'
    if (ratio > 0.2) return 'text-lg'
    return 'text-base'
  }

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
            标签云
          </h1>
          <p className="text-sm mb-12" style={{ color: 'var(--text-faint)' }}>
            <Tag size={14} className="inline mr-1" />
            共 {tags.length} 个标签
          </p>
        </motion.div>

        {loading ? (
          <div className="flex flex-wrap gap-4 skeleton-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded-full" style={{ width: `${60 + i * 20}px`, background: 'var(--bg-surface)' }} />
            ))}
          </div>
        ) : tags.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>暂无标签</p>
        ) : (
          <>
            {/* 标签云 */}
            <motion.div
              className="flex flex-wrap items-center gap-4 mb-16"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              {tags.map((tag, i) => (
                <motion.div
                  key={tag.slug}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    to={`/?tag=${tag.slug}`}
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-all duration-200 hover:shadow-md ${getSize(tag.post_count)}`}
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      color: 'var(--accent)',
                      border: '1px solid var(--accent-border)',
                    }}
                  >
                    # {tag.name}
                    <span
                      className="text-xs px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                    >
                      {tag.post_count}
                    </span>
                  </Link>
                </motion.div>
              ))}
            </motion.div>

            {/* 标签列表 */}
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {tags.map((tag, i) => (
                <motion.div
                  key={tag.slug}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.03 }}
                >
                  <Link
                    to={`/?tag=${tag.slug}`}
                    className="flex items-center justify-between px-6 py-4 transition-colors duration-200"
                    style={{ borderBottom: '1px solid var(--border-muted)' }}
                  >
                    <span className="flex items-center gap-3">
                      <Tag size={16} style={{ color: 'var(--accent)' }} />
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{tag.name}</span>
                    </span>
                    <span
                      className="text-sm px-3 py-1 rounded-full"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      {tag.post_count} 篇文章
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
