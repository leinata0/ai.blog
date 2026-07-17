import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Calendar, Pin, Search, Sparkles, Tag } from 'lucide-react'

import { fetchPosts, prefetchPostDetail } from '../api/posts'
import { useSite } from '../contexts/SiteContext'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Sidebar from '../components/Sidebar'
import TagFilterBar from '../components/TagFilterBar'
import Pagination from '../components/Pagination'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import AmbientHeroBackdrop from '../components/AmbientHeroBackdrop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import HeroFocusLine from '../components/HeroFocusLine'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import SiteHeroPosterStage from '../components/SiteHeroPosterStage'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import {
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
} from '../utils/structuredData'
import {
  CONTENT_TYPE_META,
  SITE_COPY,
  getContentTypeMeta,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

function HeroSearch({ searchInput, onInputChange, onSubmit, onClear }) {
  return (
    <form onSubmit={onSubmit} className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
      <label className="relative flex-1">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input
          value={searchInput}
          onChange={onInputChange}
          aria-label="搜索文章"
          placeholder={SITE_COPY.homeSearchPlaceholder}
        className="w-full rounded-[1.3rem] border px-11 py-3.5 text-sm outline-none transition-colors focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)]"
          style={{
            backgroundColor: 'var(--bg-surface-strong)',
            borderColor: 'var(--border-muted)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--card-shadow-soft)',
          }}
        />
      </label>

      <div className="flex gap-3">
        <button
          type="submit"
          className="rounded-[1.3rem] px-5 py-3.5 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {SITE_COPY.homeSearchAction}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-[1.3rem] px-4 py-3.5 text-sm font-semibold transition-colors duration-200"
          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
        >
          {SITE_COPY.homeClearAction}
        </button>
      </div>
    </form>
  )
}

function PostCard({ post, onTagSelect, onPrefetch }) {
  const contentMeta = getContentTypeMeta(post.content_type)

  return (
    <motion.article
      key={post.slug}
      variants={motionItemVariants}
      whileHover={hoverLift}
      data-ui="post-card"
      className={`cover-card relative overflow-hidden ${post.is_pinned ? 'ring-2 ring-[var(--accent-border)] ring-offset-2 ring-offset-[var(--bg-canvas)]' : ''}`}
    >
      <Link to={`/posts/${post.slug}`} className="block" onMouseEnter={() => onPrefetch(post.slug)} onFocus={() => onPrefetch(post.slug)}>
        {post.cover_image ? (
          <div className="editorial-cover h-60 overflow-hidden">
            <img
              src={proxyImageUrl(post.cover_image)}
              alt={post.title}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.05]"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </div>
        ) : null}

        <div className="p-7 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {contentMeta ? (
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: contentMeta.background, color: contentMeta.accent }}
              >
                {contentMeta.label}
              </span>
            ) : null}

            {post.is_pinned ? (
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: 'rgba(250, 204, 21, 0.14)', color: '#a16207' }}
              >
                <Pin size={12} />
                推荐
              </span>
            ) : null}

            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {formatDate(post.created_at)}
            </span>
          </div>

          <h2 className="mt-5 font-display text-[1.9rem] font-semibold leading-tight" style={{ color: 'var(--text-primary)' }}>
            {post.title}
          </h2>
          <p className="mt-4 text-[15px] leading-8" style={{ color: 'var(--text-secondary)' }}>
            {post.summary}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-faint)' }}>
              <Calendar size={13} /> {post.coverage_date || formatDate(post.created_at)}
            </span>

            {(post.tags || []).map((item) => (
              <button
                key={item.slug}
                onClick={(event) => {
                  event.preventDefault()
                  onTagSelect(item.slug)
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Tag size={12} /> {item.name}
              </button>
            ))}
          </div>
        </div>
      </Link>
    </motion.article>
  )
}

export default function HomePage() {
  const { settings, bootstrap, bootstrapLoading, loading: siteLoading } = useSite()
  const [tag, setTag] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [posts, setPosts] = useState(() => (Array.isArray(bootstrap?.posts?.items) ? bootstrap.posts.items : []))
  const [loading, setLoading] = useState(() => !bootstrap?.posts)
  const [slowLoading, setSlowLoading] = useState(false)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(() => bootstrap?.posts?.total ?? 0)
  const [pageSize] = useState(10)
  const postsRequestRef = useRef(0)
  const postsAbortRef = useRef(null)
  const hasInteractedRef = useRef(false)

  const heroImage = settings?.hero_image || settings?.avatar_url || ''
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const homeJsonLd = useMemo(() => ([
    buildWebSiteJsonLd({
      siteUrl,
      name: SITE_COPY.brand,
      description: SITE_COPY.homeSubtitle,
    }),
    buildCollectionPageJsonLd({
      siteUrl,
      name: SITE_COPY.brand,
      description: SITE_COPY.homeSubtitle,
      path: '/',
      image: heroImage,
    }),
  ]), [heroImage, siteUrl])

  useEffect(() => {
    document.title = SITE_COPY.brand
  }, [])

  const prefetchPost = useCallback((slug) => {
    prefetchPostDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }, [])

  const applyBootstrapPayload = useCallback((payload) => {
    if (!payload?.posts) return false

    postsAbortRef.current?.abort()
    postsAbortRef.current = null
    postsRequestRef.current += 1

    startTransition(() => {
      setPosts(Array.isArray(payload.posts.items) ? payload.posts.items : [])
      setTotal(payload.posts.total ?? 0)
    })
    setLoading(false)
    setSlowLoading(false)
    setError('')
    return true
  }, [])

  const loadPosts = useCallback(() => {
    const isDefaultView = !tag && !searchQuery && page === 1
    if ((siteLoading || bootstrapLoading) && !bootstrap?.posts && isDefaultView) {
      return
    }

    if (isDefaultView && !hasInteractedRef.current && applyBootstrapPayload(bootstrap)) {
      return
    }

    postsAbortRef.current?.abort()
    const controller = new AbortController()
    postsAbortRef.current = controller
    const requestId = postsRequestRef.current + 1
    postsRequestRef.current = requestId

    setLoading(true)
    setSlowLoading(false)
    setError('')

    const timer = setTimeout(() => setSlowLoading(true), 3000)

    fetchPosts(
      { tag: tag || undefined, q: searchQuery || undefined, page, pageSize },
      { signal: controller.signal, dedupe: false, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
    )
      .then((result) => {
        if (controller.signal.aborted || requestId !== postsRequestRef.current) return
        clearTimeout(timer)
        startTransition(() => {
          setPosts(result.items)
          setTotal(result.total)
        })
        setLoading(false)
        setSlowLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') {
          clearTimeout(timer)
          return
        }
        clearTimeout(timer)
        setError('暂时无法加载文章列表，请稍后再试。')
        setLoading(false)
        setSlowLoading(false)
      })
  }, [applyBootstrapPayload, bootstrap, bootstrapLoading, page, pageSize, searchQuery, siteLoading, tag])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  useEffect(() => () => {
    postsAbortRef.current?.abort()
  }, [])

  const tags = useMemo(() => {
    const map = new Map()
    posts.forEach((post) => {
      (post.tags || []).forEach((item) => map.set(item.slug, item))
    })
    return Array.from(map.values())
  }, [posts])

  function handleSearch(event) {
    event.preventDefault()
    hasInteractedRef.current = true
    setPage(1)
    setSearchQuery(searchInput.trim())
  }

  function clearSearch() {
    hasInteractedRef.current = true
    setPage(1)
    setSearchInput('')
    setSearchQuery('')
  }

  function handleTagSelect(nextTag) {
    hasInteractedRef.current = true
    setPage(1)
    setTag(nextTag)
    setSearchQuery('')
    setSearchInput('')
  }

  function handlePageChange(newPage) {
    hasInteractedRef.current = true
    setPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main data-ui="home-shell" className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title={SITE_COPY.brand}
        description={SITE_COPY.homeSubtitle}
        path="/"
        image={heroImage}
        jsonLd={homeJsonLd}
        rssUrl={buildPublicApiUrl('/feed.xml')}
      />
      <Navbar />

      <section className="relative overflow-hidden px-6 py-16 sm:px-10 sm:py-24 lg:px-20 lg:py-28">
        <AmbientHeroBackdrop />
        <div className="relative mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,24rem)] lg:items-center lg:gap-20">
          <motion.div
            className="max-w-3xl flex-1"
            variants={motionContainerVariants}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={motionItemVariants} className="section-kicker">
              <Sparkles size={12} />
              {SITE_COPY.homeBadge}
            </motion.div>

            <motion.h1 variants={motionItemVariants} className="section-title max-w-4xl">
              {SITE_COPY.homeTitle}
            </motion.h1>

            <motion.div variants={motionItemVariants}>
              <HeroFocusLine phrases={SITE_COPY.homeFocusLines} />
            </motion.div>

            <motion.p variants={motionItemVariants} className="section-description max-w-3xl">
              {SITE_COPY.homeSubtitle}
            </motion.p>

            <motion.div variants={motionItemVariants}>
              <HeroSearch
                searchInput={searchInput}
                onInputChange={(event) => setSearchInput(event.target.value)}
                onSubmit={handleSearch}
                onClear={clearSearch}
              />
            </motion.div>

            {!searchQuery ? (
              <motion.div
                variants={motionItemVariants}
                className="mt-6 flex flex-wrap gap-3 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                {SITE_COPY.homeSignalLabels.map((label) => (
                  <span key={label} className="term-tag">
                    {label}
                  </span>
                ))}
              </motion.div>
            ) : null}

            <motion.div variants={motionItemVariants} className="mt-6">
              <Link
                to="/start-here"
                className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
              >
                第一次来？从开始阅读进入
                <ArrowRight size={14} />
              </Link>
            </motion.div>
          </motion.div>

          <motion.div
            className="lg:flex lg:min-h-[32rem] lg:items-center lg:justify-end"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
          >
            <SiteHeroPosterStage image={heroImage} imageAlt={SITE_COPY.homePosterAlt} />
          </motion.div>
        </div>
      </section>

      {searchQuery ? (
        <div className="mx-auto max-w-7xl px-6 pt-2 sm:px-10 lg:px-20">
          <div className="break-words rounded-[1.3rem] border px-4 py-3 text-sm [overflow-wrap:anywhere]" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', color: 'var(--text-secondary)' }}>
            搜索结果：“{searchQuery}”
            <span className="ml-2" style={{ color: 'var(--text-faint)' }}>
              共 {total} 篇
            </span>
          </div>
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl px-6 py-12 sm:px-10 lg:px-20">
        <div className="flex flex-col gap-10 lg:flex-row">
          <div className="min-w-0 flex-1">
            <EditorialSectionHeader
              eyebrow="最新文章"
              title="继续阅读今天与本周的更新"
              description="这里保留完整文章流，你可以按标签、搜索和分页继续向下浏览。"
              className="mb-6"
            />

            <div className="mb-8 sticky top-[4.5rem] z-20 -mx-1 rounded-[1.3rem] border border-[var(--border-muted)] bg-[var(--bg-surface)]/90 px-3 py-3 shadow-[var(--card-shadow-soft)] backdrop-blur-md sm:px-4">
              <TagFilterBar
                tags={tags}
                activeTag={tag}
                onTagSelect={handleTagSelect}
              />
            </div>

            <section aria-label="文章列表">
              {loading ? (
                <div className="space-y-5">
                  {slowLoading ? (
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
                      正在唤醒服务，请稍候...
                    </div>
                  ) : null}
                  <LoadingSkeletonSet count={1} minHeight="18rem" />
                  <LoadingSkeletonSet count={2} className="grid gap-5" minHeight="14rem" />
                </div>
              ) : error ? (
                <EmptyStatePanel title="加载失败" description={error} />
              ) : posts.length === 0 ? (
                <EmptyStatePanel
                  title="当前筛选下没有匹配内容"
                  description="可以换个标签、清空搜索，或直接从主题和系列页继续浏览。"
                />
              ) : (
                <motion.div className="space-y-6" variants={motionContainerVariants} initial="hidden" animate="visible">
                  {posts.map((post) => (
                    <PostCard
                      key={post.slug}
                      post={post}
                      onPrefetch={prefetchPost}
                      onTagSelect={handleTagSelect}
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
            <div className="sticky top-24">
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
