import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Calendar, Pin, Search, Sparkles, Tag } from 'lucide-react'

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
import SeriesEditorialStack from '../components/SeriesEditorialStack'
import {
  getContinueReadingItems,
  getFollowedTopics,
  getRecentTopics,
} from '../utils/topicRetention'
import {
  CONTENT_TYPE_META,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function HeroSearch({ searchInput, onInputChange, onSubmit, onClear }) {
  return (
    <form onSubmit={onSubmit} className="mt-8 flex max-w-xl items-center gap-3">
      <label className="relative flex-1">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input
          value={searchInput}
          onChange={onInputChange}
          placeholder="搜索文章、主题或系列"
          className="w-full rounded-2xl border px-10 py-3 text-sm outline-none"
          style={{
            backgroundColor: 'rgba(255,255,255,0.9)',
            borderColor: 'rgba(255,255,255,0.4)',
            color: 'var(--text-primary)',
          }}
        />
      </label>
      <button type="submit" className="rounded-2xl px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
        搜索
      </button>
      <button type="button" onClick={onClear} className="rounded-2xl px-4 py-3 text-sm font-medium" style={{ backgroundColor: 'rgba(255,255,255,0.7)', color: 'var(--text-secondary)' }}>
        清空
      </button>
    </form>
  )
}

function WeeklySpotlight({ post }) {
  return (
    <motion.section
      data-ui="home-weekly-spotlight"
      variants={motionItemVariants}
      className="editorial-panel rounded-3xl p-6 sm:p-8"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}>
            周报主卡
          </div>
          <h2 className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            先读一篇，看清这一周最重要的变化
          </h2>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            周报会把一周内最值得回看的动态串成更清晰的脉络，方便你快速建立上下文。
          </p>
        </div>
        <Link to="/weekly" className="inline-flex items-center gap-1 text-sm font-medium" style={{ color: '#2563eb' }}>
          查看全部周报
          <ArrowRight size={14} />
        </Link>
      </div>

      {post ? (
        <Link
          to={`/posts/${post.slug}`}
          className="mt-6 block rounded-3xl border border-[var(--border-muted)] px-5 py-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-[rgba(37,99,235,0.28)]"
          style={{ backgroundColor: 'var(--bg-canvas)' }}
        >
          <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            {post.coverage_date ? <span>{post.coverage_date}</span> : null}
            <span>{CONTENT_TYPE_META.weekly_review.label}</span>
          </div>
          <h3 className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h3>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </Link>
      ) : (
        <div className="mt-6 rounded-3xl px-5 py-5" style={{ backgroundColor: 'var(--bg-canvas)' }}>
          <p style={{ color: 'var(--text-faint)' }}>最新周报会出现在这里。</p>
        </div>
      )}
    </motion.section>
  )
}

function DailyCard({ post }) {
  return (
    <motion.article
      data-ui="home-daily-rail"
      variants={motionItemVariants}
      whileHover={hoverLift}
      className="editorial-card rounded-3xl border px-5 py-5"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
    >
      <Link to={`/posts/${post.slug}`} className="block">
        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {post.coverage_date || formatDate(post.created_at)}
        </div>
        <h3 className="mt-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h3>
        <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
      </Link>
    </motion.article>
  )
}

function TopicCard({ topic }) {
  return (
    <motion.article
      data-ui="home-hot-topics"
      variants={motionItemVariants}
      whileHover={hoverLift}
      className="editorial-card overflow-hidden rounded-3xl border"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
    >
      <Link to={`/topics/${topic.topic_key}`} className="block">
        <div className="px-5 py-5">
          <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span
              className="rounded-full px-2.5 py-1"
              style={{
                backgroundColor: topic.is_featured ? 'rgba(37, 99, 235, 0.12)' : 'var(--accent-soft)',
                color: topic.is_featured ? '#2563eb' : 'var(--accent)',
              }}
            >
              {topic.is_featured ? '编辑推荐' : '持续追踪'}
            </span>
            {topic.post_count ? <span>{topic.post_count} 篇文章</span> : null}
          </div>
          <h3 className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{getTopicTitle(topic)}</h3>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            主题强调“内容在讲什么”，帮助你沿着同一条线索持续跟进模型、公司与产品变化。
          </p>
        </div>
      </Link>
    </motion.article>
  )
}

function PostCard({ post, onTagSelect }) {
  const contentMeta = CONTENT_TYPE_META[post.content_type]

  return (
    <motion.article
      key={post.slug}
      variants={motionItemVariants}
      whileHover={hoverLift}
      data-ui="post-card"
      className={`editorial-card relative overflow-hidden rounded-xl border ${post.is_pinned ? 'ring-2 ring-[rgba(73,177,245,0.55)] ring-offset-2 ring-offset-[var(--bg-canvas)]' : ''}`}
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
    >
      {contentMeta ? (
        <div className="absolute left-4 top-4 z-10">
          <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: contentMeta.background, color: contentMeta.accent }}>
            {contentMeta.label}
          </span>
        </div>
      ) : null}

      {post.is_pinned ? (
        <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
          <Pin size={12} />
          置顶
        </div>
      ) : null}

      {post.cover_image ? (
        <Link to={`/posts/${post.slug}`} className="block">
          <div className="editorial-cover h-52 overflow-hidden">
            <img
              src={proxyImageUrl(post.cover_image)}
              alt={post.title}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              loading="lazy"
              referrerPolicy="no-referrer"
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
          {post.tags.map((item) => (
            <button
              key={item.slug}
              onClick={() => onTagSelect(item.slug)}
              className="flex cursor-pointer items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-[rgba(73,177,245,0.1)] hover:text-[var(--accent)]"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Tag size={12} /> {item.name}
            </button>
          ))}
        </div>
      </div>
    </motion.article>
  )
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
    document.title = 'AI 资讯观察'
  }, [])

  useEffect(() => {
    fetchSeriesList()
      .then(setSeriesList)
      .catch(() => setSeriesList([]))
    fetchTopics({ featured: true, limit: 4 })
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
        setError('无法加载文章列表，请稍后重试。')
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
    [posts],
  )
  const latestDaily = useMemo(
    () => posts.filter((post) => post.content_type === 'daily_brief').slice(0, 4),
    [posts],
  )
  const homeSeries = useMemo(() => {
    const deduped = new Map()
    const featured = seriesList.filter((series) => series.is_featured)

    featured.forEach((series) => {
      deduped.set(series.slug, series)
    })
    seriesList.forEach((series) => {
      if (!deduped.has(series.slug)) {
        deduped.set(series.slug, series)
      }
    })

    return Array.from(deduped.values()).slice(0, 4)
  }, [seriesList])
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
        className="relative px-6 py-16 sm:px-10 sm:py-24 lg:px-20 lg:py-28"
        style={{
          background: 'linear-gradient(180deg, rgba(73,177,245,0.18) 0%, rgba(73,177,245,0.06) 42%, transparent 100%)',
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl flex-1">
            <h2 className="sr-only">AI 资讯观察</h2>
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(255,255,255,0.72)', color: '#2563eb' }}>
              <Sparkles size={12} />
              AI 资讯观察站
            </div>
            <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight" style={{ color: 'var(--text-primary)' }}>
              持续更新 AI 最新动态与关键变化的中文博客
            </h1>
            <p className="mt-5 text-lg leading-8" style={{ color: 'var(--text-secondary)' }}>
              聚焦值得持续追踪的消息、产品更新与产业线索，用更清晰的结构整理每一天和每一周的重要变化。
            </p>
            <HeroSearch
              searchInput={searchInput}
              onInputChange={(event) => setSearchInput(event.target.value)}
              onSubmit={handleSearch}
              onClear={clearSearch}
            />
          </div>

          <motion.div
            className="hidden h-[320px] w-[320px] overflow-hidden rounded-[2rem] lg:block"
            animate={{ y: [0, -8, 0] }}
            transition={{ repeat: Infinity, duration: 4.2, ease: 'easeInOut' }}
            style={{ boxShadow: '0 24px 70px rgba(73,177,245,0.22)' }}
          >
            {heroImage ? (
              <img src={proxyImageUrl(heroImage)} alt="站点封面" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="flex h-full items-end bg-[linear-gradient(160deg,rgba(73,177,245,0.22),rgba(37,99,235,0.08))] p-8">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: '#2563eb' }}>AI Signals</div>
                  <div className="mt-3 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>日报、周报、系列、主题</div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>

      {searchQuery ? (
        <div className="mx-auto max-w-7xl px-6 pt-6 sm:px-10 lg:px-20">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span>搜索结果：“{searchQuery}”</span>
            <span style={{ color: 'var(--text-faint)' }}>共 {total} 篇</span>
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
              <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="mb-10 space-y-8">
                <WeeklySpotlight post={latestWeekly} />

                <motion.section variants={motionItemVariants}>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>最新日报流</h2>
                      <p className="mt-1 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                        快速浏览当天值得跟进的 AI 消息、产品更新与行业变化。
                      </p>
                    </div>
                    <Link to="/daily" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      查看日报
                    </Link>
                  </div>

                  <motion.div variants={motionContainerVariants} className="grid gap-4 md:grid-cols-2">
                    {latestDaily.length > 0 ? latestDaily.map((post) => (
                      <DailyCard key={post.slug} post={post} />
                    )) : (
                      <div className="rounded-3xl px-5 py-5 md:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <p style={{ color: 'var(--text-faint)' }}>最新日报会出现在这里。</p>
                      </div>
                    )}
                  </motion.div>
                </motion.section>

                <motion.section variants={motionItemVariants}>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>系列入口</h2>
                      <p className="mt-1 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                        系列强调“如何组织阅读路径”，帮助你把分散文章串成一条更好追踪的栏目主线。
                      </p>
                    </div>
                    <Link to="/series" className="text-sm font-medium" style={{ color: '#2563eb' }}>
                      查看全部系列
                    </Link>
                  </div>

                  <SeriesEditorialStack
                    items={homeSeries}
                    mode="compact"
                    emptyText="系列入口正在整理中。"
                    dataUi="home-series-showcase"
                  />
                </motion.section>

                <motion.section variants={motionItemVariants}>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>热门主题</h2>
                      <p className="mt-1 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                        主题强调“内容在讲什么”，帮助你沿着同一条问题线索持续回看关键变化。
                      </p>
                    </div>
                    <Link to="/topics" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      查看主题页
                    </Link>
                  </div>
                  <motion.div variants={motionContainerVariants} className="grid gap-4 md:grid-cols-2">
                    {featuredTopics.length > 0 ? featuredTopics.map((topic) => (
                      <TopicCard key={topic.topic_key} topic={topic} />
                    )) : (
                      <div className="rounded-3xl px-5 py-5 md:col-span-2" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        <p style={{ color: 'var(--text-faint)' }}>热门主题会在这里展示。</p>
                      </div>
                    )}
                  </motion.div>
                </motion.section>

                <motion.section variants={motionItemVariants}>
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>继续阅读与关注主题</h2>
                      <p className="mt-1 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                        这些状态仅保存在当前浏览器里，用于帮你快速回到正在跟进的文章和主题。
                      </p>
                    </div>
                    <Link to="/following" className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      打开追踪页
                    </Link>
                  </div>
                  <motion.div variants={motionContainerVariants} className="grid gap-4 lg:grid-cols-3">
                    <motion.div variants={motionItemVariants}>
                      <ContinueReadingSection items={continueReading} />
                    </motion.div>
                    <motion.div variants={motionItemVariants}>
                      <RecentTopicsSection items={followedTopics} title="最近关注主题" emptyText="在文章页或主题页关注主题后，这里会形成快捷入口。" />
                    </motion.div>
                    <motion.div variants={motionItemVariants}>
                      <RecentTopicsSection items={recentTopics} title="最近浏览主题" emptyText="阅读带有主题的文章后，这里会自动沉淀最近浏览记录。" />
                    </motion.div>
                  </motion.div>
                </motion.section>
              </motion.div>
            ) : null}

            <section aria-label="文章列表">
              {loading ? (
                <div>
                  {slowLoading ? (
                    <div className="mb-6 flex items-center gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                      正在唤醒服务...
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
                <p className="pt-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>暂无匹配的文章。</p>
              ) : (
                <motion.div className="space-y-6" variants={motionContainerVariants} initial="hidden" animate="visible">
                  {posts.map((post) => (
                    <PostCard
                      key={post.slug}
                      post={post}
                      onTagSelect={(nextTag) => {
                        setTag(nextTag)
                        setSearchQuery('')
                        setSearchInput('')
                      }}
                    />
                  ))}
                </motion.div>
              )}

              {!loading && !error && posts.length > 0 ? (
                <Pagination page={page} total={total} pageSize={pageSize} onPageChange={handlePageChange} />
              ) : null}
            </section>
          </div>

          <div className="flex-shrink-0 lg:w-[380px]">
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
