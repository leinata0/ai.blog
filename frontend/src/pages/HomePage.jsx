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
      style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}
    >
      <Navbar />

      {/* Hero Section */}
      <div
        className="relative px-6 sm:px-10 py-16 sm:py-24"
        style={{ backgroundColor: 'var(--bg-canvas-deep)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <div className="mx-auto max-w-6xl">
          <h1 className="text-fluid-4xl font-extrabold tracking-tight mb-4" style={{ letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            极客开发日志
          </h1>
          <p className="text-fluid-lg mb-2" style={{ color: 'var(--text-secondary)' }}>
            记录 Python 自动化、C/C++ 核心概念与 OpenClaw 部署实践
          </p>
          <div className="flex items-center gap-4 text-fluid-xs" style={{ color: 'var(--text-faint)' }}>
            <span>📅 更新于 2026</span>
            <span>📚 Docs文档</span>
            <span>👁️ 浏览量: 72236</span>
          </div>
        </div>
      </div>

      {/* Main Content + Sidebar Layout */}
      <div className="mx-auto max-w-6xl px-6 sm:px-10 py-10 sm:py-14">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Left: Main Content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />
            </div>

            <section aria-label="文章列表">
              {loading ? (
                <div>
                  <div className="mb-6"><ArticleSkeleton size="hero" /></div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ArticleSkeleton size="grid" />
                    <ArticleSkeleton size="grid" />
                  </div>
                </div>
              ) : posts.length === 0 ? (
                <p className="text-fluid-sm pt-4" style={{ color: 'var(--text-tertiary)' }}>
                  暂无匹配的文章
                </p>
              ) : (
                <div>
                  {hero && (
                    <div className="mb-6" data-ui="post-card">
                      <HeroCard post={hero} />
                    </div>
                  )}
                  {rest.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {rest.map((post) => (
                        <div key={post.slug} data-ui="post-card">
                          <GridCard post={post} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>

          {/* Right: Sidebar */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="lg:sticky lg:top-20">
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
