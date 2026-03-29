import { useEffect, useMemo, useState } from 'react'
import { fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'
import HeroCard from '../components/HeroCard'
import GridCard from '../components/GridCard'

export default function HomePage() {
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchPosts(tag || undefined).then((items) => {
      if (!active) return
      setPosts(items)
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

  const [hero, ...rest] = posts

  return (
    <main
      data-ui="home-shell"
      className="min-h-screen"
      style={{ backgroundColor: '#F4F5F7' }}
    >
      <Navbar />

      {/* Hero Banner */}
      <div
        className="relative px-20 py-32"
        style={{
          background: 'linear-gradient(to bottom, #E8EAED, #D6D9DD)',
          minHeight: '400px'
        }}
      >
        <div className="mx-auto max-w-7xl flex items-center justify-between">
          <div className="flex-1 max-w-3xl">
            <h1 className="text-6xl font-bold tracking-tight mb-5 leading-tight" style={{ color: '#1A1A1A' }}>
              极客开发日志
            </h1>
            <p className="text-2xl mb-5" style={{ color: '#5F6368' }}>
              记录 Python 自动化、C/C++ 核心概念与 OpenClaw 部署实践
            </p>
            <div className="flex items-center gap-5 text-sm" style={{ color: '#5F6368' }}>
              <span>📅 更新于 2026</span>
              <span>📁 Docs文档</span>
              <span>👁️ 浏览量: 72236</span>
            </div>
          </div>
          <div className="w-[280px] h-[280px] rounded-full bg-white flex items-center justify-center" style={{ boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid #FFFFFF' }}>
            <span className="text-8xl">👨‍💻</span>
          </div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-7xl px-20 py-12">
        <div className="flex gap-10">
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
              ) : posts.length === 0 ? (
                <p className="text-sm pt-4" style={{ color: '#7F8C8D' }}>
                  暂无匹配的文章
                </p>
              ) : (
                <div className="space-y-6">
                  {posts.map((post) => (
                    <article
                      key={post.slug}
                      className="bg-white rounded-xl p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
                      style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.07), 0 1px 4px rgba(0, 0, 0, 0.03)' }}
                    >
                      <a href={`/posts/${post.slug}`} className="block">
                        <h2 className="text-2xl font-semibold mb-4" style={{ color: '#111111' }}>
                          {post.title}
                        </h2>
                        <p className="text-[15px] leading-relaxed mb-4" style={{ color: '#666666' }}>
                          {post.summary}
                        </p>
                        <div className="flex items-center gap-4">
                          <span className="text-[13px]" style={{ color: '#999999' }}>2026-03-25</span>
                          {post.tags.map((tag) => (
                            <span
                              key={tag.slug}
                              className="px-3 py-1.5 rounded-md text-xs font-medium"
                              style={{ backgroundColor: '#E3F2FD', color: '#49B1F5' }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      </a>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Right: Sidebar */}
          <div className="w-[380px] flex-shrink-0">
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
