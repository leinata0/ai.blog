import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calendar, Eye, Tag, Search, X } from 'lucide-react'
import { fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'
import Pagination from '../components/Pagination'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.12 } },
}

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' } },
}

const hoverGlow = {
  y: -5,
  boxShadow: '0 8px 30px rgba(73,177,245,0.12), 0 2px 8px rgba(0,0,0,0.06)',
  transition: { duration: 0.2 },
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function HomePage() {
  const [tag, setTag] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize] = useState(10)

  const loadPosts = useCallback(() => {
    setLoading(true)
    setError('')
    fetchPosts({ tag: tag || undefined, q: searchQuery || undefined, page, pageSize })
      .then((result) => {
        setPosts(result.items)
        setTotal(result.total)
        setLoading(false)
      })
      .catch(() => {
        setError('无法加载文章列表，请稍后重试')
        setLoading(false)
      })
  }, [tag, searchQuery, page, pageSize])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  useEffect(() => {
    setPage(1)
  }, [tag, searchQuery])

  const tags = useMemo(() => {
    const map = new Map()
    posts.forEach((post) => {
      post.tags.forEach((item) => map.set(item.slug, item))
    })
    return Array.from(map.values())
  }, [posts])

  function handleSearch(e) {
    e.preventDefault()
    setSearchQuery(searchInput.trim())
  }

  function clearSearch() {
    setSearchInput('')
    setSearchQuery('')
  }

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
            <p className="text-fluid-lg mb-6" style={{ color: 'var(--text-secondary)' }}>
              记录 Python 自动化、C/C++ 核心概念与 OpenClaw 部署实践
            </p>

            {/* 搜索框 */}
            <form onSubmit={handleSearch} className="flex items-center gap-3 max-w-lg">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 rounded-xl text-sm outline-none transition-all duration-200"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-muted)',
                    color: 'var(--text-primary)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                  placeholder="搜索文章标题或摘要..."
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
              >
                搜索
              </button>
            </form>
          </div>
          <motion.div
            className="hidden lg:flex w-[280px] h-[280px] rounded-full items-center justify-center"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid var(--bg-surface)' }}
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            <span className="text-8xl">👨‍💻</span>
          </motion.div>
        </div>
      </div>

      {/* 搜索状态提示 */}
      {searchQuery && (
        <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 pt-6">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>搜索结果："{searchQuery}"</span>
            <span style={{ color: 'var(--text-faint)' }}>（共 {total} 篇）</span>
            <button onClick={clearSearch} className="ml-2 text-xs px-2 py-1 rounded" style={{ color: 'var(--accent)' }}>
              清除搜索
            </button>
          </div>
        </div>
      )}

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-20 py-12">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* Left: Main Content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <TagFilterBar tags={tags} activeTag={tag} onTagSelect={(t) => { setTag(t); setSearchQuery(''); setSearchInput('') }} />
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
                      whileHover={hoverGlow}
                      className="rounded-xl overflow-hidden cursor-pointer"
                      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                    >
                      {post.cover_image && (
                        <Link to={`/posts/${post.slug}`} className="block">
                          <div className="w-full h-48 overflow-hidden">
                            <img
                              src={post.cover_image}
                              alt={post.title}
                              className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                              loading="lazy"
                            />
                          </div>
                        </Link>
                      )}
                      <div className="p-8">
                        <Link to={`/posts/${post.slug}`} className="block">
                          <h2 className="text-2xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                            {post.title}
                          </h2>
                          <p className="text-[15px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
                            {post.summary}
                          </p>
                        </Link>
                        <div className="flex items-center flex-wrap gap-4">
                          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                            <Calendar size={13} /> {formatDate(post.created_at)}
                          </span>
                          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                            <Eye size={13} /> {post.view_count || 0}
                          </span>
                          {post.tags.map((t) => (
                            <button
                              key={t.slug}
                              onClick={() => { setTag(t.slug); setSearchQuery(''); setSearchInput('') }}
                              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer transition-colors duration-200 hover:text-[var(--accent)] hover:bg-[rgba(73,177,245,0.1)]"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              <Tag size={12} /> {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.article>
                  ))}
                </motion.div>
              )}

              {!loading && !error && posts.length > 0 && (
                <Pagination page={page} total={total} pageSize={pageSize} onPageChange={setPage} />
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

      <Footer />
      <BackToTop />
    </main>
  )
}
