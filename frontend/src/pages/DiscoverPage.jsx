import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Search, Sparkles } from 'lucide-react'

import { fetchDiscover, fetchSearch, fetchSeriesList, fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

export default function DiscoverPage() {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState({ content_type: '', series: '' })
  const [posts, setPosts] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = 'Discover - 极客开发日志'
    fetchSeriesList().then(setSeriesList).catch(() => setSeriesList([]))
    fetchTopics({ featured: true, page_size: 6 }).then((payload) => {
      setTopics(Array.isArray(payload?.items) ? payload.items : [])
    }).catch(() => setTopics([]))
  }, [])

  useEffect(() => {
    setLoading(true)
    const loader = query || filters.content_type || filters.series
      ? fetchSearch({
          q: query || undefined,
          content_type: filters.content_type || undefined,
          series_slug: filters.series || undefined,
          sort: 'relevance',
        })
      : fetchDiscover({
          content_type: filters.content_type || undefined,
          series: filters.series || undefined,
        })

    loader
      .then((payload) => setPosts(payload.items || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false))
  }, [filters.content_type, filters.series, query])

  const emptyMessage = useMemo(() => {
    if (query || filters.content_type || filters.series) return '当前筛选下还没有匹配内容，可以换个关键词或先进入主题页。'
    return '这里会持续聚合值得继续追踪的主题、文章和系列入口。'
  }, [filters, query])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <section className="rounded-3xl px-8 py-8" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
            <Compass size={16} />
            Discover
          </div>
          <h1 className="mt-3 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>发现值得持续追踪的内容主线</h1>
          <div className="mt-6 grid gap-4 md:grid-cols-[1.5fr,1fr,1fr]">
            <label className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、摘要或主题"
                className="w-full rounded-2xl border px-10 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              />
            </label>
            <select
              value={filters.content_type}
              onChange={(event) => setFilters((current) => ({ ...current, content_type: event.target.value }))}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部类型</option>
              <option value="daily_brief">日报</option>
              <option value="weekly_review">周报</option>
            </select>
            <select
              value={filters.series}
              onChange={(event) => setFilters((current) => ({ ...current, series: event.target.value }))}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="">全部系列</option>
              {seriesList.map((series) => <option key={series.slug} value={series.slug}>{series.title}</option>)}
            </select>
          </div>
        </section>

        <section className="mt-8 rounded-3xl px-6 py-6" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            <Sparkles size={15} />
            推荐主题
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {topics.length > 0 ? topics.slice(0, 6).map((topic) => (
              <Link key={topic.topic_key} to={`/topics/${topic.topic_key}`} className="rounded-2xl px-4 py-4 transition-colors duration-200 hover:bg-[var(--bg-canvas)]">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{topic.display_title}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {topic.post_count ? `${topic.post_count} 篇文章` : '主题页'}
                </div>
              </Link>
            )) : (
              <div className="md:col-span-3 text-sm" style={{ color: 'var(--text-faint)' }}>推荐主题会在这里展示。</div>
            )}
          </div>
        </section>

        <section className="mt-8 space-y-4">
          {loading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-32 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))
          ) : posts.length === 0 ? (
            <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <p style={{ color: 'var(--text-faint)' }}>{emptyMessage}</p>
            </div>
          ) : posts.map((post) => (
            <Link
              key={post.slug}
              to={`/posts/${post.slug}`}
              className="block rounded-3xl px-6 py-5"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                {post.content_type ? <span>{post.content_type === 'weekly_review' ? '周报' : '日报'}</span> : null}
                {post.series_slug ? <span>系列：{post.series_slug}</span> : null}
                {post.topic_key ? <span>主题：{post.topic_key}</span> : null}
                {post.coverage_date ? <span>{post.coverage_date}</span> : null}
              </div>
              <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
            </Link>
          ))}
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
