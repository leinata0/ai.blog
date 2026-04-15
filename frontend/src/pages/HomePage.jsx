import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calendar, Eye, Tag, Search, X, Pin, Layers3, ArrowRight } from 'lucide-react'

import { fetchPosts, fetchSeriesList, fetchTopics } from '../api/posts'
import { useSite } from '../contexts/SiteContext'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'
import Pagination from '../components/Pagination'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import ContinueReadingSection from '../components/ContinueReadingSection'
import RecentTopicsSection from '../components/RecentTopicsSection'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'

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

const CONTENT_TYPE_META = {
  daily_brief: {
    label: '日报快报',
    accent: 'var(--accent)',
    background: 'var(--accent-soft)',
  },
  weekly_review: {
    label: '每周回顾',
    accent: '#2563eb',
    background: 'rgba(37,99,235,0.12)',
  },
}

export default function HomePage() {
  const { settings } = useSite()
  const [tag, setTag] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [posts, setPosts] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [hotTopics, setHotTopics] = useState([])
  const [followedTopics, setFollowedTopics] = useState([])
  const [recentTopics, setRecentTopics] = useState([])
  const [continueReading, setContinueReading] = useState([])
  const [loading, setLoading] = useState(true)
  const [slowLoading, setSlowLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize] = useState(10)

  const heroImage = settings?.hero_image || settings?.avatar_url || ''

  useEffect(() => {
    document.title = '极客开发日志'
  }, [])

  useEffect(() => {
    fetchSeriesList({ featured: true })
      .then(setSeriesList)
      .catch(() => setSeriesList([]))
    fetchTopics({ featured: true, page_size: 4, sort: 'activity' })
      .then((payload) => setHotTopics(Array.isArray(payload?.items) ? payload.items : []))
      .catch(() => setHotTopics([]))
  }, [])

  useEffect(() => {
    function syncRetentionState() {
      setFollowedTopics(getFollowedTopics().slice(0, 4))
      setRecentTopics(getRecentTopics(4))
      setContinueReading(getContinueReadingItems(4))
    }

    syncRetentionState()
    window.addEventListener('focus', syncRetentionState)
    window.addEventListener('storage', syncRetentionState)
    return () => {
      window.removeEventListener('focus', syncRetentionState)
      window.removeEventListener('storage', syncRetentionState)
    }
  }, [])

  const loadPosts = useCallback(() => {
    setLoading(true)
    setSlowLoading(false)
    setError('')

    const timer = setTimeout(() => setSlowLoading(true), 3000)

    fetchPosts({ tag: tag || undefined, q: searchQuery || undefined, page, pageSize })
      .then((result) => {
        setPosts(result.items)
        setTotal(result.total)
        setLoading(false)
        setSlowLoading(false)
        clearTimeout(timer)
      })
      .catch(() => {
        setError('无法加载文章列表，请稍后重试')
        setLoading(false)
        setSlowLoading(false)
        clearTimeout(timer)
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

  const latestWeekly = useMemo(
    () => posts.find((post) => post.content_type === 'weekly_review') || null,
    [posts]
  )
  const latestDaily = useMemo(
    () => posts.filter((post) => post.content_type === 'daily_brief').slice(0, 4),
    [posts]
  )
  const featuredSeries = useMemo(() => seriesList.slice(0, 3), [seriesList])
  const featuredTopics = useMemo(() => hotTopics.slice(0, 4), [hotTopics])

  function handleSearch(event) {
    event.preventDefault()
    setSearchQuery(searchInput.trim())
  }

  function clearSearch() {
    setSearchInput('')
    setSearchQuery('')
  }

  function handlePageChange(newPage) {
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main data-ui="home-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />

      <div
        className="relative px-6 py-16 sm:px-10 sm:py-24 lg:px-20 lg:py-32"
        style={{
          background: 'linear-gradient(to bottom, var(--bg-canvas-deep), var(--border-strong))',
          minHeight: '400px',
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="max-w-3xl flex-1">
            <h1 className="mb-5 text-fluid-4xl font-bold tracking-tight leading-tight" style={{ color: 'var(--text-primary)' }}>
              极客开发日志
            </h1>
            <p className="mb-6 text-fluid-lg" style={{ color: 'var(--text-secondary)' }}>
              把自动发布升级成可追踪、可发现、可沉淀的 AI 内容产品。
            </p>

            <form onSubmit={handleSearch} className="flex max-w-lg items-center gap-3">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  className="w-full rounded-xl py-3 pl-10 pr-10 text-sm outline-none transition-all duration-200"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-muted)',
                    color: 'var(--text-primary)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  }}
                  placeholder="搜索文章标题、摘要或主题"
                />
                {searchInput ? (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5"
                    style={{ color: 'var(--text-faint)' }}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                className="rounded-xl px-5 py-3 text-sm font-medium transition-all duration-200"
                style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
              >
                搜索
              </button>
            </form>
          </div>
          <motion.div
            className="hidden h-[280px] w-[280px] items-center justify-center overflow-hidden rounded-full lg:flex"
            style={{ backgroundColor: 'var(--bg-surface)', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)', border: '4px solid var(--bg-surface)' }}
            animate={{ y: [0, -10, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          >
            {heroImage ? (
              <img src={proxyImageUrl(heroImage)} alt="hero" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-8xl">AI</span>
            )}
          </motion.div>
        </div>
      </div>

      {searchQuery ? (
        <div className="mx-auto max-w-7xl px-6 pt-6 sm:px-10 lg:px-20">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>搜索结果: "{searchQuery}"</span>
            <span style={{ color: 'var(--text-faint)' }}>共 {total} 篇</span>
            <button onClick={clearSearch} className="ml-2 rounded px-2 py-1 text-xs" style={{ color: 'var(--accent)' }}>
              清除搜索
            </button>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10 lg:px-20">
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-8">
              <TagFilterBar
                tags={tags}
                activeTag={tag}
                onTagSelect={(nextTag) => {
                  setTag(nextTag)
                  setSearchQuery('')
                  setSearchInput('')
                }}
              />
            </div>

            {!loading && !error ? (
              <div className="mb-10 space-y-8">
                <section
                  data-ui="home-weekly-spotlight"
                  className="rounded-3xl p-6 sm:p-8"
                  style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}>
                        每周回顾
                      </div>
                      <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                        周报主卡
                      </h2>
                      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                        先读一篇能解释一周节奏变化的长文，再决定继续追哪条主线。
                      </p>
                    </div>
                    <Link to="/weekly" className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: '#2563eb' }}>
                      查看全部周报
                      <ArrowRight size={14} />
                    </Link>
                  </div>

                  {latestWeekly ? (
                    <Link to={`/posts/${latestWeekly.slug}`} className="mt-6 block rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                      <h3 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{latestWeekly.title}</h3>
                      <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{latestWeekly.summary}</p>
                    </Link>
                  ) : (
                    <div className="mt-6 rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-canvas)' }}>
                      <p style={{ color: 'var(--text-faint)' }}>最新周报会在这里出现。</p>
                    </div>
                  )}
                </section>

                <section data-ui="home-daily-rail">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>最新日报流</h2>
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        按天筛出值得继续观察的 AI 新闻、产品更新与策略变化。
                      </p>
                    </div>
                    <Link to="/daily" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      查看日报
                    </Link>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {latestDaily.length > 0 ? latestDaily.map((post) => (
                      <Link
                        key={post.slug}
                        to={`/posts/${post.slug}`}
                        className="block rounded-3xl px-5 py-5"
                        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                      >
                        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {post.coverage_date || formatDate(post.created_at)}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h3>
                        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
                      </Link>
                    )) : (
                      <div className="rounded-3xl px-5 py-5 md:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <p style={{ color: 'var(--text-faint)' }}>最新日报会在这里出现。</p>
                      </div>
                    )}
                  </div>
                </section>

                <section data-ui="home-series-showcase">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>系列 / 专题入口</h2>
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        把日报和周报沉淀成长期主线，而不只是一次性发布。
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link to="/series" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>查看系列</Link>
                      <Link to="/discover" className="text-sm font-medium" style={{ color: '#2563eb' }}>进入 Discover</Link>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    {featuredSeries.length > 0 ? featuredSeries.map((series) => (
                      <Link
                        key={series.slug}
                        to={`/series/${series.slug}`}
                        className="block rounded-3xl px-5 py-5"
                        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                      >
                        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}>
                          <Layers3 size={12} />
                          系列
                        </div>
                        <h3 className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{series.title}</h3>
                        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                          {series.description || '围绕主题持续追踪。'}
                        </p>
                      </Link>
                    )) : (
                      <div className="rounded-3xl px-5 py-5 md:col-span-3" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <p style={{ color: 'var(--text-faint)' }}>系列入口正在准备中。</p>
                      </div>
                    )}
                  </div>
                </section>

                <section data-ui="home-hot-topics">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>热门主题</h2>
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        从单篇文章切换到主题主线，按 topic_key 持续追踪日报、周报和专题沉淀。
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Link to="/topics" className="text-sm font-medium" style={{ color: '#2563eb' }}>查看主题页</Link>
                      <Link to="/search" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>进入搜索</Link>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {featuredTopics.length > 0 ? featuredTopics.map((topic) => (
                      <Link
                        key={topic.topic_key}
                        to={`/topics/${topic.topic_key}`}
                        className="block rounded-3xl px-5 py-5"
                        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                      >
                        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                          <span>{topic.is_featured ? '编辑推荐' : '持续追踪'}</span>
                          {topic.post_count ? <span>{topic.post_count} 篇文章</span> : null}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{topic.display_title}</h3>
                        <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                          {topic.description || '进入主题页查看这一条主线下的日报、周报与系列内容。'}
                        </p>
                      </Link>
                    )) : (
                      <div className="rounded-3xl px-5 py-5 md:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <p style={{ color: 'var(--text-faint)' }}>热门主题会在这里展示。</p>
                      </div>
                    )}
                  </div>
                </section>

                <section data-ui="home-retention-rails">
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>继续阅读与关注主题</h2>
                      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        这些内容只保存在当前浏览器，本机刷新后依然保留，不会影响现有自动发文链路。
                      </p>
                    </div>
                    <Link to="/following" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      打开追踪页
                    </Link>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <ContinueReadingSection items={continueReading} />
                    <RecentTopicsSection items={followedTopics} title="最近关注主题" emptyText="在文章页或主题页关注主题后，这里会形成快捷入口。" />
                    <RecentTopicsSection items={recentTopics} title="最近浏览主题" emptyText="阅读带 topic_key 的文章后，这里会自动沉淀最近主题。" />
                  </div>
                </section>
              </div>
            ) : null}

            <section aria-label="文章列表">
              {loading ? (
                <div>
                  {slowLoading ? (
                    <div className="mb-6 flex items-center gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                      正在唤醒服务器...
                    </div>
                  ) : null}
                  <div className="mb-6"><ArticleSkeleton size="hero" /></div>
                  <div className="grid grid-cols-1 gap-6">
                    <ArticleSkeleton size="grid" />
                    <ArticleSkeleton size="grid" />
                  </div>
                </div>
              ) : error ? (
                <p className="pt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>{error}</p>
              ) : posts.length === 0 ? (
                <p className="pt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>暂无匹配的文章</p>
              ) : (
                <motion.div className="space-y-6" variants={containerVariants} initial="hidden" animate="visible">
                  {posts.map((post) => (
                    <motion.article
                      key={post.slug}
                      data-ui="post-card"
                      data-pinned={post.is_pinned ? 'true' : undefined}
                      variants={cardVariants}
                      whileHover={hoverGlow}
                      className={`relative cursor-pointer overflow-hidden rounded-xl ${post.is_pinned ? 'ring-2 ring-[rgba(73,177,245,0.65)] ring-offset-2 ring-offset-[var(--bg-canvas)]' : ''}`}
                      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                      animate={post.is_pinned ? { boxShadow: ['0 0 24px rgba(73,177,245,0.2), var(--card-shadow)', '0 0 36px rgba(73,177,245,0.35), var(--card-shadow)', '0 0 24px rgba(73,177,245,0.2), var(--card-shadow)'] } : undefined}
                      transition={post.is_pinned ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : undefined}
                    >
                      {post.content_type && CONTENT_TYPE_META[post.content_type] ? (
                        <div className="absolute left-4 top-4 z-10">
                          <span
                            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold shadow-sm"
                            style={{
                              backgroundColor: CONTENT_TYPE_META[post.content_type].background,
                              color: CONTENT_TYPE_META[post.content_type].accent,
                              border: '1px solid rgba(255,255,255,0.2)',
                            }}
                          >
                            {CONTENT_TYPE_META[post.content_type].label}
                          </span>
                        </div>
                      ) : null}

                      {post.is_pinned ? (
                        <div
                          className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold shadow-md"
                          style={{
                            background: 'linear-gradient(135deg, #FEF3C7 0%, #FBBF24 50%, #F59E0B 100%)',
                            color: '#78350F',
                            border: '1px solid rgba(180,83,9,0.35)',
                          }}
                        >
                          <Pin size={12} className="shrink-0" style={{ transform: 'rotate(-12deg)' }} />
                          置顶
                        </div>
                      ) : null}

                      {post.cover_image ? (
                        <Link to={`/posts/${post.slug}`} className="block">
                          <div className="h-48 w-full overflow-hidden">
                            <img
                              src={proxyImageUrl(post.cover_image)}
                              alt={post.title}
                              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(event) => { event.target.parentElement.parentElement.style.display = 'none' }}
                            />
                          </div>
                        </Link>
                      ) : null}

                      <div className="p-8">
                        <Link to={`/posts/${post.slug}`} className="block">
                          <h2 className="mb-4 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {post.title}
                          </h2>
                          <p className="mb-4 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                            {post.summary}
                          </p>
                        </Link>
                        <div className="flex flex-wrap items-center gap-4">
                          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                            <Calendar size={13} /> {formatDate(post.created_at)}
                          </span>
                          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
                            <Eye size={13} /> {post.view_count || 0}
                          </span>
                          {post.tags.map((item) => (
                            <button
                              key={item.slug}
                              onClick={() => {
                                setTag(item.slug)
                                setSearchQuery('')
                                setSearchInput('')
                              }}
                              className="flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-[rgba(73,177,245,0.1)] hover:text-[var(--accent)]"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              <Tag size={12} /> {item.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.article>
                  ))}
                </motion.div>
              )}

              {!loading && !error && posts.length > 0 ? (
                <Pagination page={page} total={total} pageSize={pageSize} onPageChange={handlePageChange} />
              ) : null}
            </section>
          </div>

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
