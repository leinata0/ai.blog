import { useEffect, useMemo, useState } from 'react'
import { fetchPosts } from '../api/posts'
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
      {/* ── Top nav bar ──────────────────────────────── */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-6 sm:px-10"
        style={{
          height: '52px',
          borderBottom: '1px solid var(--border-muted)',
          backgroundColor: 'var(--bg-canvas)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Wordmark in monospace */}
        <span
          className="font-terminal text-fluid-sm font-semibold tracking-mono-normal"
          style={{ color: 'var(--text-primary)' }}
        >
          <span style={{ color: 'var(--accent)' }}>~/</span>
          极客开发日志
        </span>

        {/* Right slot — terminal prompt hint */}
        <span
          className="font-terminal text-fluid-xs tracking-mono-normal hidden sm:block"
          style={{ color: 'var(--text-faint)' }}
        >
          dev.log v2026
        </span>
      </nav>

      {/* ── Page container ───────────────────────────── */}
      <div className="mx-auto max-w-5xl px-6 sm:px-10">

        {/* ── Masthead ─────────────────────────────── */}
        <header className="pt-18 pb-14 sm:pt-26 sm:pb-18">
          <p
            className="font-terminal text-fluid-xs font-medium tracking-mono-wide mb-4"
            style={{ color: 'var(--accent)' }}
          >
            $ cat posts.log
          </p>
          <h1
            className="text-fluid-hero font-extrabold tracking-tight mb-5 cursor-blink"
            style={{ letterSpacing: '-0.03em' }}
          >
            极客开发日志
          </h1>
          <p
            className="max-w-lg text-fluid-base leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            记录 Python 自动化、C/C++ 核心概念与 OpenClaw 部署实践中的关键笔记。
          </p>
        </header>

        {/* ── Filter bar ───────────────────────────── */}
        <div className="mb-10 sm:mb-14">
          <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />
        </div>

        {/* ── Content zone ─────────────────────────── */}
        <section
          className="pb-26 sm:pb-38"
          aria-label="文章列表"
        >
          {loading ? (
            /* Skeleton: 1 wide + 2 grid */
            <div>
              <div className="mb-6">
                <ArticleSkeleton size="hero" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ArticleSkeleton size="grid" />
                <ArticleSkeleton size="grid" />
              </div>
            </div>
          ) : posts.length === 0 ? (
            <p
              className="font-terminal text-fluid-sm pt-4"
              style={{ color: 'var(--text-tertiary)' }}
            >
              // no posts match this filter
            </p>
          ) : (
            <div>
              {/* ── Hero — first post, full width ── */}
              {hero && (
                <div className="mb-6" data-ui="post-card">
                  <HeroCard post={hero} />
                </div>
              )}

              {/* ── Grid — remaining posts ── */}
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

      {/* ── Footer ───────────────────────────────────── */}
      <footer
        className="border-t px-6 sm:px-10 py-6 flex items-center justify-between"
        style={{ borderColor: 'var(--border-muted)' }}
      >
        <span
          className="font-terminal text-fluid-xs tracking-mono-normal"
          style={{ color: 'var(--text-faint)' }}
        >
          极客开发日志
        </span>
        <span
          className="font-terminal text-fluid-xs tracking-mono-normal"
          style={{ color: 'var(--accent)' }}
        >
          [EOF]
        </span>
      </footer>
    </main>
  )
}
