import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarRange, Compass, Search, Sparkles } from 'lucide-react'

import { fetchSearch, fetchSeriesList, fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { formatDate } from '../utils/date'

const DEFAULT_FILTERS = {
  content_type: '',
  series_slug: '',
  topic_key: '',
  date_from: '',
  date_to: '',
  sort: 'relevance',
}

function SearchResultCard({ post }) {
  return (
    <Link
      to={`/posts/${post.slug}`}
      className="block rounded-3xl px-6 py-5"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
        {post.content_type ? <span>{post.content_type === 'weekly_review' ? '周报' : '日报'}</span> : null}
        {post.topic_key ? <span>主题：{post.topic_key}</span> : null}
        {post.coverage_date ? <span>{post.coverage_date}</span> : null}
      </div>
      <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {post.quality_score ? <span>质量分 {post.quality_score}</span> : null}
        {post.reading_time ? <span>阅读 {post.reading_time} 分钟</span> : null}
        <span>{formatDate(post.created_at)}</span>
      </div>
    </Link>
  )
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [queryInput, setQueryInput] = useState(searchParams.get('q') || '')
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [filters, setFilters] = useState({
    ...DEFAULT_FILTERS,
    content_type: searchParams.get('content_type') || '',
    series_slug: searchParams.get('series_slug') || '',
    topic_key: searchParams.get('topic_key') || '',
    date_from: searchParams.get('date_from') || '',
    date_to: searchParams.get('date_to') || '',
    sort: searchParams.get('sort') || 'relevance',
  })
  const [results, setResults] = useState([])
  const [topicSuggestions, setTopicSuggestions] = useState([])
  const [topics, setTopics] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    document.title = '搜索 - 极客开发日志'
    fetchTopics({ featured: true, page_size: 8 }).then((payload) => {
      setTopics(Array.isArray(payload?.items) ? payload.items : [])
    }).catch(() => setTopics([]))
    fetchSeriesList().then(setSeriesList).catch(() => setSeriesList([]))
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setTopicSuggestions(topics.slice(0, 4))
      return
    }

    setLoading(true)
    fetchSearch({
      q: query.trim(),
      content_type: filters.content_type || undefined,
      series_slug: filters.series_slug || undefined,
      topic_key: filters.topic_key || undefined,
      date_from: filters.date_from || undefined,
      date_to: filters.date_to || undefined,
      sort: filters.sort || undefined,
    }).then((payload) => {
      setResults(Array.isArray(payload?.items) ? payload.items : [])
      setTopicSuggestions(Array.isArray(payload?.topics) ? payload.topics : [])
    }).catch(() => {
      setResults([])
      setTopicSuggestions([])
    }).finally(() => setLoading(false))
  }, [filters, query, topics])

  const hasActiveQuery = Boolean(query.trim())
  const emptyMessage = useMemo(() => {
    if (!hasActiveQuery) return '输入关键词后，可以按主题、系列、日期和内容类型检索整站内容。'
    return '暂时没有找到匹配结果，可以换个关键词，或先从推荐主题继续追踪。'
  }, [hasActiveQuery])

  function handleSubmit(event) {
    event.preventDefault()
    const trimmed = queryInput.trim()
    setQuery(trimmed)
    const next = new URLSearchParams()
    if (trimmed) next.set('q', trimmed)
    Object.entries(filters).forEach(([key, value]) => {
      if (value) next.set(key, value)
    })
    setSearchParams(next)
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <section className="rounded-3xl px-8 py-8" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
            <Search size={16} />
            站内搜索
          </div>
          <h1 className="mt-3 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>搜索主题、文章与主线变化</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            先找具体信息，再顺着同一条主题主线继续读日报、周报和专题内容。
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-[1.4fr,1fr,1fr]">
              <label className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="例如：OpenAI、推理模型、Agent、MCP"
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
                <option value="">全部内容类型</option>
                <option value="daily_brief">日报</option>
                <option value="weekly_review">周报</option>
              </select>
              <select
                value={filters.series_slug}
                onChange={(event) => setFilters((current) => ({ ...current, series_slug: event.target.value }))}
                className="rounded-2xl border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="">全部系列</option>
                {seriesList.map((series) => (
                  <option key={series.slug} value={series.slug}>{series.title}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <select
                value={filters.topic_key}
                onChange={(event) => setFilters((current) => ({ ...current, topic_key: event.target.value }))}
                className="rounded-2xl border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="">全部主题</option>
                {topics.map((topic) => (
                  <option key={topic.topic_key} value={topic.topic_key}>{topic.display_title}</option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>
                <CalendarRange size={14} />
                <input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} className="min-w-0 bg-transparent outline-none" />
              </label>
              <label className="flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>
                <CalendarRange size={14} />
                <input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} className="min-w-0 bg-transparent outline-none" />
              </label>
              <select
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
                className="rounded-2xl border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="relevance">按相关度</option>
                <option value="latest">按最新</option>
                <option value="quality">按质量优先</option>
              </select>
            </div>

            <button type="submit" className="rounded-2xl px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
              开始搜索
            </button>
          </form>
        </section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr),280px]">
          <div className="space-y-4">
            {loading ? (
              [1, 2, 3].map((item) => (
                <div key={item} className="h-32 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
              ))
            ) : results.length > 0 ? (
              results.map((post) => <SearchResultCard key={post.slug} post={post} />)
            ) : (
              <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
                <p style={{ color: 'var(--text-faint)' }}>{emptyMessage}</p>
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <section className="rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
                <Compass size={15} />
                推荐主题
              </div>
              <div className="mt-4 space-y-3">
                {(topicSuggestions.length > 0 ? topicSuggestions : topics.slice(0, 5)).map((topic) => (
                  <Link key={topic.topic_key} to={`/topics/${topic.topic_key}`} className="block rounded-2xl px-4 py-3 transition-colors duration-200 hover:bg-[var(--bg-canvas)]">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{topic.display_title}</div>
                    <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                      {topic.post_count ? `${topic.post_count} 篇文章` : '主题页'}
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                <Sparkles size={15} />
                搜索建议
              </div>
              <ul className="mt-4 space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li>先搜公司名或产品名，再切到同主题页继续追踪。</li>
                <li>想看长期变化时，优先选“按质量优先”或进入周报。</li>
                <li>找某条主线时，可以先筛选主题，再限定日期区间。</li>
              </ul>
            </section>
          </aside>
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
