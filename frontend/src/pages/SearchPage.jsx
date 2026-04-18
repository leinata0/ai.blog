import { startTransition, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CalendarRange, Compass, Search } from 'lucide-react'

import {
  fetchSearch,
  fetchSeriesList,
  fetchTopics,
  prefetchPostDetail,
  prefetchSeriesDetail,
  prefetchTopicDetail,
} from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { formatDate } from '../utils/date'
import { buildSubscriptionCenterHref } from '../utils/subscriptionLinks'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import {
  getContentTypeLabel,
  getSeriesTitle,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

const DEFAULT_FILTERS = {
  content_type: '',
  series_slug: '',
  topic_key: '',
  date_from: '',
  date_to: '',
  sort: 'relevance',
}

function getMatchReasonLabel(reason) {
  if (reason === 'title') return '标题命中'
  if (reason === 'topic') return '主题命中'
  if (reason === 'summary') return '摘要命中'
  if (reason === 'tag_or_series') return '标签或系列命中'
  return '相关结果'
}

function SearchResultCard({ post, seriesTitle, topicTitle, onPrefetch }) {
  return (
    <motion.article
      variants={motionItemVariants}
      whileHover={hoverLift}
      className="editorial-card rounded-[1.8rem] border px-6 py-5"
    >
      <Link
        to={`/posts/${post.slug}`}
        className="block"
        onMouseEnter={() => onPrefetch(post.slug)}
        onFocus={() => onPrefetch(post.slug)}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-faint)' }}>
          <span className="rounded-full px-2.5 py-1" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
            {getContentTypeLabel(post.content_type)}
          </span>
          {topicTitle ? <span>主题：{topicTitle}</span> : null}
          {seriesTitle ? <span>系列：{seriesTitle}</span> : null}
          {post.coverage_date ? <span>{post.coverage_date}</span> : null}
        </div>

        <h2 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {post.title}
        </h2>
        <p className="mt-3 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
          {post.summary}
        </p>
      </Link>

      <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
        {post.quality_score ? <span>质量分：{post.quality_score}</span> : null}
        {post.reading_time ? <span>阅读 {post.reading_time} 分钟</span> : null}
        <span>{formatDate(post.created_at)}</span>
        {post.match_reason ? <span>{getMatchReasonLabel(post.match_reason)}</span> : null}
      </div>
    </motion.article>
  )
}

export default function SearchPage() {
  const { settings } = useSite()
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
  const [seriesSuggestions, setSeriesSuggestions] = useState([])
  const [popularQueries, setPopularQueries] = useState([])
  const [topics, setTopics] = useState([])
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(false)
  const hasActiveQuery = Boolean(query.trim())
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const canonicalPath = useMemo(() => {
    const queryString = searchParams.toString()
    return queryString ? `/search?${queryString}` : '/search'
  }, [searchParams])
  const jsonLd = useMemo(() => ([
    buildCollectionPageJsonLd({
      siteUrl,
      name: query ? `搜索：${query}` : '站内搜索',
      description: hasActiveQuery
        ? `搜索 ${query} 相关的文章、主题与系列，并继续沿主题主线深入阅读。`
        : '在站内按主题、系列、日期和内容类型搜索 AI 资讯与观察内容。',
      path: canonicalPath,
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '搜索', path: canonicalPath },
      ],
    }),
  ]), [canonicalPath, hasActiveQuery, query, siteUrl])

  useEffect(() => {
    document.title = '搜索 - AI 资讯观察'
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    fetchTopics(
      { featured: true, limit: 8 },
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 30000, staleTtl: 120000 },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        const nextTopics = Array.isArray(payload?.items) ? payload.items : []
        startTransition(() => {
          setTopics(nextTopics)
          setTopicSuggestions((current) => (current.length > 0 ? current : nextTopics.slice(0, 4)))
        })
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setTopics([])
      })

    fetchSeriesList(
      { limit: 12 },
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 30000, staleTtl: 120000 },
    )
      .then((items) => {
        if (controller.signal.aborted) return
        startTransition(() => setSeriesList(items))
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setSeriesList([])
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setTopicSuggestions(topics.slice(0, 4))
      setSeriesSuggestions([])
      setPopularQueries([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    fetchSearch(
      {
        q: query.trim(),
        content_type: filters.content_type || undefined,
        series_slug: filters.series_slug || undefined,
        topic_key: filters.topic_key || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
        sort: filters.sort || undefined,
      },
      { signal: controller.signal, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
    )
      .then((payload) => {
        if (controller.signal.aborted) return
        startTransition(() => {
          setResults(Array.isArray(payload?.items) ? payload.items : [])
          setTopicSuggestions(Array.isArray(payload?.topics) ? payload.topics : [])
          setSeriesSuggestions(Array.isArray(payload?.series_suggestions) ? payload.series_suggestions : [])
          setPopularQueries(Array.isArray(payload?.popular_queries) ? payload.popular_queries : [])
        })
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setResults([])
        setTopicSuggestions([])
        setSeriesSuggestions([])
        setPopularQueries([])
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [filters, query, topics])

  const emptyMessage = useMemo(() => {
    if (!hasActiveQuery) return '输入关键词后，可以按主题、系列、日期和内容类型检索整站内容。'
    return '暂时没有找到匹配结果，可以换一个关键词，或先从推荐主题继续追踪。'
  }, [hasActiveQuery])

  const seriesBySlug = useMemo(
    () => Object.fromEntries(seriesList.map((series) => [series.slug, getSeriesTitle(series)])),
    [seriesList],
  )
  const topicByKey = useMemo(
    () => Object.fromEntries(topics.map((topic) => [topic.topic_key, getTopicTitle(topic)])),
    [topics],
  )
  const rescueTopics = useMemo(
    () => (topicSuggestions.length > 0 ? topicSuggestions.slice(0, 4) : topics.slice(0, 4)),
    [topicSuggestions, topics],
  )
  const rescueSeries = useMemo(
    () => (seriesSuggestions.length > 0 ? seriesSuggestions.slice(0, 4) : seriesList.slice(0, 4)),
    [seriesList, seriesSuggestions],
  )
  const rescueQueries = useMemo(
    () => popularQueries.filter((item) => item?.query).slice(0, 6),
    [popularQueries],
  )

  function prefetchPost(slug) {
    prefetchPostDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  function prefetchTopic(topicKey) {
    prefetchTopicDetail(topicKey, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  function prefetchSeries(slug) {
    prefetchSeriesDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  function applySearch(nextQuery) {
    const trimmed = String(nextQuery || '').trim()
    setQueryInput(trimmed)
    setQuery(trimmed)
    const next = new URLSearchParams()
    if (trimmed) next.set('q', trimmed)
    Object.entries(filters).forEach(([key, value]) => {
      if (value) next.set(key, value)
    })
    setSearchParams(next)
  }

  function handleSubmit(event) {
    event.preventDefault()
    applySearch(queryInput)
  }

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title={hasActiveQuery ? `搜索：${query} - AI 资讯观察` : '搜索 - AI 资讯观察'}
        description={hasActiveQuery
          ? `搜索 ${query} 相关的文章、主题与系列，并继续沿主题主线深入阅读。`
          : '在站内按主题、系列、日期和内容类型搜索 AI 资讯与观察内容。'}
        path={canonicalPath}
        jsonLd={jsonLd}
      />
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
        >
          <EditorialSectionHeader
            eyebrow="站内搜索"
            title="搜索主题、文章与主线变化"
            description="先找到具体信息，再顺着同一条主题主线继续阅读日报、周报与系列内容。"
          />

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-[1.4fr,1fr,1fr]">
              <label className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  placeholder="例如：OpenAI、推理模型、Agent、MCP"
                  className="w-full rounded-[1.3rem] border px-10 py-3 text-sm outline-none"
                  style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
                />
              </label>

              <select
                value={filters.content_type}
                onChange={(event) => setFilters((current) => ({ ...current, content_type: event.target.value }))}
                className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="">全部内容类型</option>
                <option value="daily_brief">日报</option>
                <option value="weekly_review">周报</option>
              </select>

              <select
                value={filters.series_slug}
                onChange={(event) => setFilters((current) => ({ ...current, series_slug: event.target.value }))}
                className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="">全部系列</option>
                {seriesList.map((series) => (
                  <option key={series.slug} value={series.slug}>
                    {getSeriesTitle(series)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <select
                value={filters.topic_key}
                onChange={(event) => setFilters((current) => ({ ...current, topic_key: event.target.value }))}
                className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="">全部主题</option>
                {topics.map((topic) => (
                  <option key={topic.topic_key} value={topic.topic_key}>
                    {getTopicTitle(topic)}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-2 rounded-[1.3rem] border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>
                <CalendarRange size={14} />
                <input
                  type="date"
                  value={filters.date_from}
                  onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))}
                  className="min-w-0 bg-transparent outline-none"
                />
              </label>

              <label className="flex items-center gap-2 rounded-[1.3rem] border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>
                <CalendarRange size={14} />
                <input
                  type="date"
                  value={filters.date_to}
                  onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))}
                  className="min-w-0 bg-transparent outline-none"
                />
              </label>

              <select
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
                className="rounded-[1.3rem] border px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: 'var(--bg-canvas)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
              >
                <option value="relevance">按相关度</option>
                <option value="latest">按最新</option>
                <option value="quality">按质量优先</option>
              </select>
            </div>

            <button type="submit" className="rounded-[1.3rem] px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
              开始搜索
            </button>
          </form>
        </motion.section>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr),300px]">
          <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            {loading ? (
              <LoadingSkeletonSet count={3} minHeight="14rem" />
            ) : results.length > 0 ? (
              results.map((post) => (
                <SearchResultCard
                  key={post.slug}
                  post={post}
                  onPrefetch={prefetchPost}
                  seriesTitle={post.series_slug ? seriesBySlug[post.series_slug] || post.series_slug : ''}
                  topicTitle={post.topic_key ? topicByKey[post.topic_key] || post.topic_key : ''}
                />
              ))
            ) : (
              <div className="space-y-4">
                <EmptyStatePanel title="还没有匹配结果" description={emptyMessage} icon={Search} />

                {hasActiveQuery ? (
                  <section className="editorial-panel rounded-[1.8rem] px-6 py-6" data-ui="search-zero-rescue">
                    <EditorialSectionHeader
                      eyebrow="零结果救援"
                      title="先从相邻主线恢复阅读路径"
                      titleClassName="!text-[1.55rem]"
                      description="没有完全命中时，先从相关主题、系列和热门查询切回更接近的阅读主线。"
                    />

                    <div className="mt-5 grid gap-5 xl:grid-cols-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-faint)' }}>
                          相关主题
                        </div>
                        <div className="mt-3 space-y-3">
                          {rescueTopics.length > 0 ? rescueTopics.map((topic) => (
                            <Link
                              key={topic.topic_key}
                              to={`/topics/${topic.topic_key}`}
                              onMouseEnter={() => prefetchTopic(topic.topic_key)}
                              onFocus={() => prefetchTopic(topic.topic_key)}
                              className="block rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                            >
                              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {getTopicTitle(topic)}
                              </div>
                              <div className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
                                {topic.post_count ? `${topic.post_count} 篇文章` : '进入主题页继续追踪'}
                              </div>
                            </Link>
                          )) : (
                            <p className="text-sm leading-7" style={{ color: 'var(--text-faint)' }}>
                              暂时没有更接近的主题建议。
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-faint)' }}>
                          推荐系列
                        </div>
                        <div className="mt-3 space-y-3">
                          {rescueSeries.length > 0 ? rescueSeries.map((series) => (
                            <Link
                              key={series.slug}
                              to={`/series/${series.slug}`}
                              onMouseEnter={() => prefetchSeries(series.slug)}
                              onFocus={() => prefetchSeries(series.slug)}
                              className="block rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                            >
                              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {getSeriesTitle(series)}
                              </div>
                              <div className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
                                {series.description || '从系列页进入更适合恢复长期阅读脉络。'}
                              </div>
                            </Link>
                          )) : (
                            <p className="text-sm leading-7" style={{ color: 'var(--text-faint)' }}>
                              暂时没有更接近的系列建议。
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--text-faint)' }}>
                          热门查询
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {rescueQueries.length > 0 ? rescueQueries.map((item) => (
                            <button
                              key={item.query}
                              type="button"
                              onClick={() => applySearch(item.query)}
                              className="rounded-full px-3 py-2 text-xs font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                            >
                              {item.query}
                            </button>
                          )) : (
                            <p className="text-sm leading-7" style={{ color: 'var(--text-faint)' }}>
                              暂时还没有足够的热门查询数据。
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </motion.div>

          <motion.aside initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
            <motion.section variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-5 py-5">
              <EditorialSectionHeader eyebrow="推荐主题" title="先沿主题继续找" titleClassName="!text-[1.4rem]" />
              <div className="mt-4 space-y-3">
                {(topicSuggestions.length > 0 ? topicSuggestions : topics.slice(0, 5)).map((topic) => (
                  <div
                    key={topic.topic_key}
                    className="rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                  >
                    <Link
                      to={`/topics/${topic.topic_key}`}
                      onMouseEnter={() => prefetchTopic(topic.topic_key)}
                      onFocus={() => prefetchTopic(topic.topic_key)}
                      className="block"
                    >
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {getTopicTitle(topic)}
                      </div>
                      <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                        {topic.post_count ? `${topic.post_count} 篇文章` : '主题页'}
                      </div>
                    </Link>
                    <Link
                      to={buildSubscriptionCenterHref({ topicKey: topic.topic_key })}
                      className="mt-3 inline-flex items-center gap-2 text-xs font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      追踪这个主题
                      <Compass size={12} />
                    </Link>
                  </div>
                ))}
              </div>
            </motion.section>

            <motion.section variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-5 py-5">
              <EditorialSectionHeader
                eyebrow="搜索即订阅"
                title="把当前关注点直接变成回访入口"
                titleClassName="!text-[1.4rem]"
                description="如果你已经搜到了想持续跟进的主线，可以直接跳到订阅中心，按主题或栏目保存提醒偏好。"
              />
              <div className="mt-4 flex flex-col gap-3">
                <Link
                  to={buildSubscriptionCenterHref({
                    contentType: filters.content_type,
                    topicKey: filters.topic_key || topicSuggestions[0]?.topic_key || '',
                    seriesSlug: filters.series_slug,
                  })}
                  className="inline-flex items-center justify-between rounded-[1.2rem] border px-4 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5"
                  style={{ borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
                >
                  <span>保存当前搜索方向的订阅偏好</span>
                  <ArrowRight size={14} style={{ color: 'var(--accent)' }} />
                </Link>
                <p className="text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
                  {hasActiveQuery
                    ? `当前搜索词是“${query}”，更适合把结果收束到主题或系列后再订阅。`
                    : '先搜索一个公司、模型或产品方向，再把它变成订阅入口。'}
                </p>
              </div>
            </motion.section>

            <motion.section variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-5 py-5">
              <EditorialSectionHeader eyebrow="搜索建议" title="更快找到主线" titleClassName="!text-[1.4rem]" />
              <ul className="mt-4 space-y-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                <li>先搜公司名或产品名，再进入同主题页继续追踪。</li>
                <li>想看长期变化时，优先选“按质量优先”或直接进入周报。</li>
                <li>找某条主线时，可以先筛主题，再限定日期区间。</li>
              </ul>
            </motion.section>
          </motion.aside>
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
