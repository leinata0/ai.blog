import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Rss } from 'lucide-react'

import { fetchDiscover, fetchPosts } from '../api/posts'
import Navbar from '../components/Navbar'
import PrimaryNewsNavigation from '../components/news/PrimaryNewsNavigation'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { formatDate, parseDate } from '../utils/date'
import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { buildSubscriptionCenterHref } from '../utils/subscriptionLinks'
import { proxyImageUrl } from '../utils/proxyImage'
import { useNewsStyle } from '../hooks/useNewsStyle'
import CinematicWeekly from '../components/tech/CinematicWeekly'
import CinematicNavigation from '../components/news/cinematic/CinematicNavigation'
import DailyEdition from '../components/news/daily/DailyEdition'
import '../styles/news-reading.css'
import '../styles/news-tech-reading.css'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import { CONTENT_TYPE_META } from '../utils/contentPresentation'

function sortByCreatedTime(posts) {
  return [...posts].sort((a, b) => (parseDate(b.created_at)?.getTime() ?? 0) - (parseDate(a.created_at)?.getTime() ?? 0))
}

function NewsCover({ post, eager = false }) {
  const [unavailable, setUnavailable] = useState(false)
  if (!post.cover_image) return null
  return (
    <div className="news-section__image">
      {unavailable ? <span>配图暂不可用</span> : <img src={proxyImageUrl(post.cover_image)} alt="" width="800" height="500" loading={eager ? 'eager' : 'lazy'} onError={() => setUnavailable(true)} />}
    </div>
  )
}

function NewsMetadata({ post }) {
  return <div className="news-section__post-meta">
    {post.created_at ? <time dateTime={post.created_at}>发布 {formatDate(post.created_at)}</time> : null}
    {post.coverage_date ? <span>覆盖 {post.coverage_date}</span> : null}
    {post.source_count ? <span>{post.source_count} 个来源</span> : null}
  </div>
}

function HeroCard({ post, meta }) {
  if (!post) return null
  return (
    <article className="news-section__lead">
      <Link to={`/posts/${post.slug}`} className={`news-section__lead-link${post.cover_image ? '' : ' news-section__lead-link--text'}`}>
        <div>
          <p className="news-section__kicker">最新一篇 · {meta.label}</p>
          <h2>{post.title}</h2>
          {post.summary ? <p className="news-section__summary">{post.summary}</p> : null}
          <NewsMetadata post={post} />
          <span className="news-section__read">阅读全文 <ArrowRight size={15} aria-hidden="true" /></span>
        </div>
        <NewsCover key={post.cover_image} post={post} eager />
      </Link>
    </article>
  )
}

function ListCard({ post, index }) {
  return (
    <article className="news-section__story">
      <span className="news-section__number" aria-hidden="true">{String(index + 2).padStart(2, '0')}</span>
      <Link to={`/posts/${post.slug}`} className="news-section__story-link">
        <div>
          <h3>{post.title}</h3>
          {post.summary ? <p>{post.summary}</p> : null}
          <NewsMetadata post={post} />
        </div>
        <NewsCover key={post.cover_image} post={post} />
      </Link>
    </article>
  )
}

export default function ContentTypePage({ contentType }) {
  const { newsStyle } = useNewsStyle()
  const { settings } = useSite()
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const copy = CONTENT_TYPE_META[contentType] || CONTENT_TYPE_META.daily_brief
  const feedUrl = buildPublicApiUrl(
    contentType === 'weekly_review' ? '/api/feeds/weekly.xml' : '/api/feeds/daily.xml'
  )
  const path = contentType === 'weekly_review' ? '/weekly' : '/daily'
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const jsonLd = useMemo(() => ([
    buildCollectionPageJsonLd({
      siteUrl,
      name: copy.title,
      description: copy.description,
      path,
      image: posts[0]?.cover_image || '',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: copy.title, path },
      ],
    }),
  ]), [copy.description, copy.title, path, posts, siteUrl])

  useEffect(() => {
    const controller = new AbortController()
    document.title = `${copy.title} - AI 资讯观察`
    setPosts([])
    setLoading(true)
    setError('')

    async function loadPosts() {
      try {
        const payload = await fetchDiscover(
          { content_type: contentType, sections: 'items,total' },
          { signal: controller.signal, dedupe: false },
        )
        if (controller.signal.aborted) return
        setPosts(Array.isArray(payload?.items) ? payload.items : [])
      } catch (err) {
        if (controller.signal.aborted || err?.name === 'AbortError') return

        try {
          const fallback = await fetchPosts(
            { pageSize: 50 },
            { signal: controller.signal, dedupe: false },
          )
          if (controller.signal.aborted) return
          setPosts((fallback.items || []).filter((post) => post.content_type === contentType))
        } catch (fallbackErr) {
          if (controller.signal.aborted || fallbackErr?.name === 'AbortError') return
          setPosts([])
          setError('栏目暂时无法加载，请稍后重试。')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    loadPosts()
    return () => controller.abort()
  }, [contentType, copy.title, retryKey])

  const orderedPosts = useMemo(() => sortByCreatedTime(posts), [posts])
  const heroPost = orderedPosts[0] || null
  const restPosts = orderedPosts.slice(1)

  if (newsStyle === 'tech' && contentType === 'daily_brief') {
    return (
      <>
        <SeoMeta
          title={`${copy.title} - AI 资讯观察`}
          description={copy.description}
          path={path}
          image={heroPost?.cover_image || ''}
          jsonLd={jsonLd}
          rssUrl={feedUrl}
        />
        <DailyEdition
          posts={orderedPosts}
          loading={loading}
          error={error}
          onRetry={() => setRetryKey((value) => value + 1)}
          feedUrl={feedUrl}
          header={<Navbar immersive><PrimaryNewsNavigation className="issue-live-primary" /></Navbar>}
          footer={<Footer />}
        />
        <BackToTop />
      </>
    )
  }

  return (
    <main id="main-content" className={newsStyle === 'tech' ? 'cinematic-section min-h-screen' : 'news-section min-h-screen'}>
      <SeoMeta
        title={`${copy.title} - AI 资讯观察`}
        description={copy.description}
        path={path}
        image={heroPost?.cover_image || ''}
        jsonLd={jsonLd}
        rssUrl={feedUrl}
      />
      {newsStyle === 'tech' ? <CinematicNavigation /> : <Navbar />}
      {newsStyle === 'tech' ? <CinematicWeekly posts={orderedPosts} loading={loading} error={error} onRetry={() => setRetryKey((value) => value + 1)} feedUrl={feedUrl} /> : <div className="news-section__wrap">
          <header className="news-section__masthead">
            <p className="news-section__kicker">{copy.englishTitle}</p>
            <h1>{copy.title}</h1>
            <p className="news-section__intro">{copy.description}</p>
            {heroPost?.created_at ? <p className="news-section__latest">最近发布 <time dateTime={heroPost.created_at}>{formatDate(heroPost.created_at)}</time></p> : null}
          </header>
          <div className="news-section__toolbar">
            <nav aria-label="新闻栏目" className="news-section__tabs">
              <Link to="/daily" aria-current={contentType === 'daily_brief' ? 'page' : undefined}>日报</Link>
              <Link to="/weekly" aria-current={contentType === 'weekly_review' ? 'page' : undefined}>周报</Link>
              <Link to="/archive">全部归档</Link>
            </nav>
            <div className="news-section__subscriptions">
              <a
                href={feedUrl}
                target="_blank"
                rel="noreferrer"
                className="news-section__subscription"
              >
                <Rss size={15} />
                订阅 {copy.title} RSS
              </a>
              <Link
                to={buildSubscriptionCenterHref({ contentType })}
                className="news-section__subscription"
              >
                订阅这个栏目
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>

          <div className="news-section__contents">
            {loading ? (
              <>
                <LoadingSkeletonSet count={1} minHeight="16rem" />
                <LoadingSkeletonSet count={3} className="grid gap-4" minHeight="6rem" />
              </>
            ) : error ? (
              <div role="alert" className="news-section__message">
                <p style={{ color: 'var(--danger-text)' }}>{error}</p>
                <button
                  type="button"
                  onClick={() => setRetryKey((value) => value + 1)}
                  className="signal-button signal-button--primary mt-4"
                >
                  重新加载栏目
                </button>
              </div>
            ) : orderedPosts.length === 0 ? (
              <EmptyStatePanel
                title={`${copy.title} 暂时还没有内容`}
                description="新的栏目文章发布后，会优先展示在这里。"
              />
            ) : (
              <div>
                <HeroCard post={heroPost} meta={copy} />

                {restPosts.length > 0 ? <h2 className="news-section__list-title">往期{copy.title} <span>{restPosts.length} 篇</span></h2> : null}
                <div className="news-section__list">
                  {restPosts.map((post, index) => (
                    <ListCard key={post.slug} post={post} index={index} />
                  ))}
                </div>
              </div>
            )}
          </div>
      </div>}
      <Footer />
      <BackToTop />
    </main>
  )
}
