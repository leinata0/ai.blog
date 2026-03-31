import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calendar, FolderOpen, Eye, Tag } from 'lucide-react'
import { fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
}

export default function HomePage() {
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    fetchPosts(tag || undefined)
      .then((items) => {
        if (!active) return
        setPosts(items)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('无法加载文章列表，请稍后重试')
        setLoading(false)
      })
    return () => { active = false }
  }, [tag])

  const tags = useMemo(() => {
    const map = new Map()
    posts.forEach((post) => {
      post.tags.forEach((item) => map.set(item.slug, item))
    })
    return Array.from(map.values())
  }, [posts])

  return (
    <main
      data-ui="home-shell"
      className="min-h-screen"
      style={{ backgroundColor: 'var(--bg-canvas)' }}
    >
      <Navbar />

      {/* Hero Banner */}
      <div
        className="relative px-6 sm:px-10 lg:px-20 py-16 sm:py-24 lg:py-32"
        style={{
          background: 'linear-gradient(to bottom, var(--bg-canvas-deep), var(--border-strong))',
          minHeight: '400px'
        }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex-1 max-w-3xl">
            <h1 className="text-fluid-4xl font-bold tracking-tight mb-5 leading-tight" style={{ color: 'var(--text-primary)' }}>
              极客开发日志
            </h1>
            <p className="text-fluid-lg mb-5" style={{ color: 'var(--text-secondary)' }}>
              记录 Python 自动化、C/C++ 核心概念与 OpenClaw 部署实践
            </p>
            <div className="flex items-center gap-5 text-fluid-xs" style={{ color: 'var(--text-secondary)' }}>
              <span className="flex items-center gap-1.5"><Calendar size={14} className="text-gray-400" /> 更新于 2026</span>
              <span className="flex items-center gap-1.5"><FolderOpen size={14} className="text-gray-400" /> Docs文档</span>
              <span className="flex items-center gap-1.5"><Eye size={14} className="text-gray-400" /> 浏览量: 72236</span>
            </div>
          </div>
          <div className="hidden lg:flex w-[280px] h-[280px] rounded-full items-center justify-center" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid var(--bg-surface)' }}>
            <span className="text-8xl">👨‍💻</span>
          </div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 py-12">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* Left: Main Content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />
            </div>

            <section aria-label="文章列表">
              {loading ? (
                <div>
                  <div className="mb-6"><ArticleSkeleton size="hero" /></div>
                  <div className="grid grid-cols-1 gap-6">
                    <ArticleSkeleton size="grid" />
                    <ArticleSkeleton size="grid" />
                  </div>
                </div>
              ) : error ? (
                <p className="text-sm pt-4" style={{ color: 'var(--text-tertiary)' }}>{error}</p>
              ) : posts.length === 0 ? (
                <p className="text-sm pt-4" style={{ color: 'var(--text-tertiary)' }}>
                  暂无匹配的文章
                </p>
              ) : (
                <motion.div
                  className="space-y-6"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {posts.map((post) => (
                    <motion.article
                      key={post.slug}
                      data-ui="post-card"
                      variants={cardVariants}
                      className="rounded-xl p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
                      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                    >
                      <Link to={`/posts/${post.slug}`} className="block">
                        <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                          {post.title}
                        </h2>
                        <p className="text-[15px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
                          {post.summary}
                        </p>
                        <div className="flex items-center gap-4">
                          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                            <Calendar size={13} className="text-gray-400" /> 2026-03-25
                          </span>
                          {post.tags.map((t) => (
                            <span
                              key={t.slug}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              <Tag size={12} /> {t.name}
                            </span>
                          ))}
                        </div>
                      </Link>
                    </motion.article>
                  ))}
                </motion.div>
              )}
            </section>
          </div>

          {/* Right: Sidebar */}
          <div className="lg:w-[380px] flex-shrink-0">
            <div className="sticky top-20">
              <Sidebar />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="border-t px-6 sm:px-10 py-6 flex items-center justify-between"
        style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-surface)' }}
      >
        <span className="text-fluid-xs" style={{ color: 'var(--text-faint)' }}>
          © 2026 极客开发日志
        </span>
        <span className="text-fluid-xs" style={{ color: 'var(--text-tertiary)' }}>
          Built with React
        </span>
      </footer>
    </main>
  )
}