import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Search } from 'lucide-react'
import { fetchPosts, prefetchPostDetail } from '../api/posts'
import { useSite } from '../contexts/SiteContext'
import { formatDate, parseDate } from '../utils/date'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import Pagination from '../components/Pagination'
import SeoMeta from '../components/SeoMeta'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import CollectionRefreshNotice from '../components/CollectionRefreshNotice'
import ArticleQuickPreview from '../components/ArticleQuickPreview'
import NewsArticle from '../components/news/NewsArticle'
import NewsFrontPage from '../components/news/NewsFrontPage'
import TechNewsIntro from '../components/news/TechNewsIntro'
import NewsroomEdition from '../components/news/NewsroomEdition'
import EditionHero from '../components/news/EditionHero'
import EditionChapterNav from '../components/news/EditionChapterNav'
import NewsReadingRail from '../components/news/NewsReadingRail'
import { useNewsStyle } from '../hooks/useNewsStyle'
import useEditionChoreography from '../hooks/useEditionChoreography'
import useNewsroomData from '../hooks/useNewsroomData'
import { buildNewsroomSections, NEWS_BEATS } from '../utils/newsroom'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { buildCollectionPageJsonLd, buildWebSiteJsonLd } from '../utils/structuredData'
import { SITE_COPY, SITE_SEO } from '../utils/contentPresentation'
import { PERFORMANCE_TRIAL_ENABLED } from '../utils/performanceTrial'
import '../styles/news-home.css'
import '../styles/news-tech-home.css'
import '../styles/news-edition.css'
import '../styles/news-edition-choreography.css'

export default function HomePage() {
  const { newsStyle } = useNewsStyle()
  const { settings, bootstrap, bootstrapLoading, loading: siteLoading, homeDataManaged,
    bootstrapError, bootstrapRefreshError, bootstrapPreview, bootstrapGeneratedAt, retryHomeBootstrap } = useSite()
  const [searchParams, setSearchParams] = useSearchParams()
  const tag = searchParams.get('tag') || ''
  const searchQuery = searchParams.get('q') || ''
  const parsedPage = Number.parseInt(searchParams.get('page') || '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const defaultView = !tag && !searchQuery && page === 1
  const managedHome = Boolean(homeDataManaged) && defaultView
  const queryKey = JSON.stringify([tag, searchQuery, page])
  const [searchInput, setSearchInput] = useState(searchQuery)
  const [loadedPosts, setPosts] = useState(() => (Array.isArray(bootstrap?.posts?.items) ? bootstrap.posts.items : []))
  const [loadedQueryKey, setLoadedQueryKey] = useState(() => bootstrap?.posts ? JSON.stringify(['', '', 1]) : null)
  const [postsLoading, setLoading] = useState(() => !bootstrap?.posts)
  const [slowLoading, setSlowLoading] = useState(false)
  const [postsError, setError] = useState('')
  const [loadedTotal, setTotal] = useState(() => bootstrap?.posts?.total ?? 0)
  const posts = managedHome ? bootstrap?.posts?.items || [] : loadedQueryKey === queryKey ? loadedPosts : []
  const total = managedHome ? bootstrap?.posts?.total ?? 0 : loadedQueryKey === queryKey ? loadedTotal : 0
  const loading = managedHome ? Boolean(bootstrapLoading) : postsLoading
  const error = managedHome ? bootstrapError || '' : postsError
  const [previewPost, setPreviewPost] = useState(null)
  const [density, setDensity] = useState('summary')
  const [newsPending, startNewsTransition] = useTransition()
  const [pageSize] = useState(10)
  const postsRequestRef = useRef(0)
  const postsAbortRef = useRef(null)
  const postsSlowTimerRef = useRef(null)
  const hasInteractedRef = useRef(false)
  const choreographyRef = useRef(null)

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
      description: SITE_SEO.homeDescription,
    }),
    buildCollectionPageJsonLd({
      siteUrl,
      name: SITE_COPY.brand,
      description: SITE_SEO.homeDescription,
      path: '/',
      image: heroImage,
    }),
  ]), [heroImage, siteUrl])

  // No `document.title = ...` here: <SeoMeta> owns the title, and setting the bare
  // brand on mount raced it back down to the short variant after hydration.

  useEffect(() => {
    setSearchInput(searchQuery)
  }, [searchQuery])

  const prefetchPost = useCallback((slug) => {
    prefetchPostDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }, [])

  const applyBootstrapPayload = useCallback((payload) => {
    if (!payload?.posts) return false

    postsAbortRef.current?.abort()
    postsAbortRef.current = null
    postsRequestRef.current += 1

    startNewsTransition(() => {
      setPosts(Array.isArray(payload.posts.items) ? payload.posts.items : [])
      setTotal(payload.posts.total ?? 0)
      setLoadedQueryKey(JSON.stringify(['', '', 1]))
    })
    setLoading(false)
    setSlowLoading(false)
    setError('')
    return true
  }, [startNewsTransition])

  const loadPosts = useCallback(() => {
    if (managedHome) {
      // Default homepage content is owned by the bounded snapshot request. A
      // settings failure must not trigger a second serial posts request.
      postsAbortRef.current?.abort()
      postsAbortRef.current = null
      postsRequestRef.current += 1
      clearTimeout(postsSlowTimerRef.current)
      return
    }
    const isDefaultView = !tag && !searchQuery && page === 1
    if ((siteLoading || bootstrapLoading) && !bootstrap?.posts && isDefaultView) {
      return
    }

    if (isDefaultView && !hasInteractedRef.current && applyBootstrapPayload(bootstrap)) {
      return
    }

    postsAbortRef.current?.abort()
    clearTimeout(postsSlowTimerRef.current)
    const controller = new AbortController()
    postsAbortRef.current = controller
    const requestId = postsRequestRef.current + 1
    postsRequestRef.current = requestId

    setLoading(true)
    setSlowLoading(false)
    setError('')

    const timer = setTimeout(() => {
      if (!controller.signal.aborted && requestId === postsRequestRef.current) setSlowLoading(true)
    }, 3000)
    postsSlowTimerRef.current = timer

    fetchPosts(
      { tag: tag || undefined, q: searchQuery || undefined, page, pageSize },
      PERFORMANCE_TRIAL_ENABLED
        ? { signal: controller.signal, timeout: 8000, dedupe: false, cache: false, staleWhileRevalidate: false }
        : { signal: controller.signal, dedupe: false, staleWhileRevalidate: true, cacheTtl: 10000, staleTtl: 45000 },
    )
      .then((result) => {
        if (controller.signal.aborted || requestId !== postsRequestRef.current) return
        clearTimeout(timer)
        startNewsTransition(() => {
          setPosts(result.items)
          setTotal(result.total)
          setLoadedQueryKey(queryKey)
        })
        setLoading(false)
        setSlowLoading(false)
      })
      .catch((err) => {
        // The transport uses AbortError for its deadline too. Only this
        // consumer's cancellation or a superseded query is a silent exit.
        if (controller.signal.aborted || requestId !== postsRequestRef.current) return
        setError('暂时无法加载文章列表，请稍后再试。')
        setLoading(false)
        setSlowLoading(false)
      })
      .finally(() => {
        clearTimeout(timer)
        if (postsSlowTimerRef.current === timer) postsSlowTimerRef.current = null
      })
  }, [applyBootstrapPayload, bootstrap, bootstrapLoading, managedHome, page, pageSize, queryKey, searchQuery, siteLoading, startNewsTransition, tag])

  useEffect(() => {
    loadPosts()
  }, [loadPosts])

  useEffect(() => () => {
    postsAbortRef.current?.abort()
    clearTimeout(postsSlowTimerRef.current)
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
    const next = new URLSearchParams()
    const query = searchInput.trim()
    if (query) next.set('q', query)
    setSearchParams(next)
  }

  function clearSearch() {
    hasInteractedRef.current = true
    setSearchInput('')
    setSearchParams(new URLSearchParams())
  }

  function handleTagSelect(nextTag) {
    hasInteractedRef.current = true
    setSearchInput('')
    const next = new URLSearchParams()
    if (nextTag) next.set('tag', nextTag)
    setSearchParams(next)
  }

  function handlePageChange(newPage) {
    hasInteractedRef.current = true
    const next = new URLSearchParams(searchParams)
    if (newPage > 1) next.set('page', String(newPage))
    else next.delete('page')
    setSearchParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const closePreview = useCallback(() => setPreviewPost(null), [])

  const immersiveHome = newsStyle === 'tech' && defaultView
  useEditionChoreography(choreographyRef, immersiveHome)
  const newsroom = useNewsroomData(immersiveHome, bootstrap?.home_modules, bootstrap?.home_topics, {
    managed: Boolean(homeDataManaged), loading: bootstrapLoading, error: bootstrapError, retry: retryHomeBootstrap,
  })
  const sections = useMemo(() => buildNewsroomSections(posts, newsroom.modules || {}), [posts, newsroom.modules])
  const feedPosts = immersiveHome ? sections.stream : defaultView ? posts.slice(7) : posts
  const latestDate = posts.reduce((latest, post) => {
    const date = parseDate(post.created_at)
    return date && (!latest || date > latest) ? date : latest
  }, null)

  const tagFilters = (
    <div className="news-tag-bar" data-ui="filter-bar" aria-label="按标签筛选新闻">
      <button type="button" aria-pressed={!tag} onClick={() => handleTagSelect('')}>全部</button>
      {tag && !tags.some((item) => item.slug === tag) ? <button type="button" aria-pressed="true" onClick={() => handleTagSelect(tag)}>{tag}</button> : null}
      {tags.slice(0, 9).map((item) => <button type="button" key={item.slug} aria-pressed={tag === item.slug} onClick={() => handleTagSelect(item.slug)}>{item.name}</button>)}
    </div>
  )
  const newsFeed = (
    <section className={`news-feed${immersiveHome && density === 'titles' ? ' news-feed--titles' : ''}`} data-density={density} aria-labelledby="news-feed-title">
      <header className="news-feed__heading">
        <div><span className="news-kicker">{immersiveHome ? 'II / THE NEWS ARCHIVE' : 'THE NEWSROOM'}</span><h2 id="news-feed-title">{searchQuery ? '搜索结果' : tag ? '主题资讯' : '新闻一览'}</h2></div>
        <span className="news-feed__count">{loading ? '正在载入…' : error ? '数量暂不可用' : '共 ' + total + ' 篇'}</span>
      </header>
      {immersiveHome ? <div className="newsroom-feed-tools"><div className="newsroom-density" role="group" aria-label="新闻显示方式"><button type="button" aria-pressed={density === 'summary'} onClick={() => setDensity('summary')}>摘要</button><button type="button" aria-pressed={density === 'titles'} onClick={() => setDensity('titles')}>标题</button></div><Link to="/archive" className="news-text-link">按日期归档 <ArrowUpRight size={13} aria-hidden="true" /></Link></div> : null}
      <form className="news-search" onSubmit={handleSearch} role="search" aria-label="站内新闻搜索">
        <Search size={17} aria-hidden="true" />
        <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label="搜索文章"
          placeholder="搜索公司、模型或新闻关键词" name="home-search" autoComplete="off" />
        <button type="submit">{SITE_COPY.homeSearchAction}</button>
        {searchInput || searchQuery || tag ? <button type="button" className="news-search__clear" onClick={clearSearch}>清空</button> : null}
      </form>
      {immersiveHome ? <details className="newsroom-tag-drawer"><summary>按标签筛选</summary>{tagFilters}</details> : tagFilters}
      {searchQuery || tag ? <p className="news-query-note">{searchQuery ? '关键词：“' + searchQuery + '”' : '当前标签：' + tag}<button type="button" onClick={clearSearch}>查看全部资讯 <ArrowRight size={12} aria-hidden="true" /></button></p> : null}
      <div className="news-article-list" role="region" aria-label="文章列表" aria-busy={loading}>
        {loading ? <><LoadingSkeletonSet count={3} minHeight="10rem" />{slowLoading ? <p role="status" className="news-status">新闻载入需要一点时间，请稍候。</p> : null}</> : error ? (
          <div className="news-error" role="alert"><p>{error}</p><button type="button" onClick={managedHome ? retryHomeBootstrap : loadPosts}>重试加载 <ArrowRight size={14} aria-hidden="true" /></button></div>
        ) : posts.length === 0 ? (
          <EmptyStatePanel title="暂时没有匹配的资讯" description="试试其他关键词，或回到新闻首页浏览。"><button type="button" className="news-text-link" onClick={clearSearch}>查看全部资讯 <ArrowRight size={14} aria-hidden="true" /></button></EmptyStatePanel>
        ) : feedPosts.length > 0 ? feedPosts.map((post) => <NewsArticle key={post.slug} post={post} onPrefetch={prefetchPost} onPreview={setPreviewPost} onTagSelect={handleTagSelect} withCoverFallback={newsStyle === 'tech'} />) : (
          <p className="news-status">本页资讯已呈现在头条区。<Link to="/archive">继续浏览历史归档 <ArrowRight size={13} aria-hidden="true" /></Link></p>
        )}
      </div>
      <Pagination page={page} total={total} pageSize={pageSize} onPageChange={handlePageChange} />
    </section>
  )

  return (
    <main ref={choreographyRef} data-ui="home-shell" className={`news-home${immersiveHome ? ' edition-home' : ''}`}>
      <SeoMeta title={SITE_SEO.homeTitle} description={SITE_SEO.homeDescription} path="/" image={heroImage}
        jsonLd={homeJsonLd} rssUrl={buildPublicApiUrl('/feed.xml')} />
      <Navbar immersive={immersiveHome} />
      {managedHome ? <CollectionRefreshNotice error={bootstrapRefreshError} preview={bootstrapPreview} generatedAt={bootstrapGeneratedAt} onRetry={retryHomeBootstrap} /> : null}
      {immersiveHome ? <EditionHero total={total} latestDate={latestDate} loading={loading || newsPending} hasError={Boolean(error)} /> : null}
      <div className="news-home__paper">
        {immersiveHome ? null : newsStyle === 'tech' ? <TechNewsIntro total={total} latestDate={latestDate} loading={loading} hasError={Boolean(error)} compact={!defaultView} /> : <header className="news-edition">
          <div>
            <div className="news-kicker">THE AI OBSERVER <span>人工智能 · 产品 · 研究 · 产业</span></div>
            <h1>{SITE_COPY.homeTitle}</h1>
          </div>
          <div className="news-edition__note">
            <span>阅读重要变化，连接新闻背景。</span>
            {latestDate ? <span>本页最新发布 <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time></span> : <span>按发布日期浏览资讯</span>}
          </div>
        </header>}

        {!immersiveHome ? <nav className="news-beats" aria-label="新闻领域">
          <span>关注领域</span>
          {NEWS_BEATS.map(({ title, query }) => <Link key={query} to={'/search?q=' + encodeURIComponent(query)}>{title}<ArrowUpRight size={12} aria-hidden="true" /></Link>)}
          <Link to="/topics" className="news-beats__all">全部主题 <ArrowRight size={13} aria-hidden="true" /></Link>
        </nav> : null}

        {immersiveHome ? <NewsroomEdition
          focus={sections.focus} deepReads={sections.deepReads} latestDate={latestDate} loading={loading || newsPending} error={error}
          modules={newsroom.modules || {}} topics={newsroom.topics || []} moduleLoading={newsroom.loading} moduleError={newsroom.error}
          deepReadsError={newsroom.modulesError}
          onRetryModules={newsroom.retry} onPrefetch={prefetchPost} onPreview={setPreviewPost}
        >{newsFeed}</NewsroomEdition> : <>
          {defaultView && !error && posts.length > 0 ? <NewsFrontPage posts={posts} onPrefetch={prefetchPost} onPreview={setPreviewPost} /> : null}
          <div className="news-feed-layout">{newsFeed}<NewsReadingRail /></div>
          <div className="news-bottom-note"><span>从一条新闻，读到更完整的背景。</span><Link to="/topics">探索主题 <ArrowRight size={15} aria-hidden="true" /></Link></div>
        </>}
      </div>
      {immersiveHome ? <EditionChapterNav ready={!loading && !newsPending} /> : null}
      <Footer /><BackToTop /><ArticleQuickPreview post={previewPost} onClose={closePreview} />
    </main>
  )
}
