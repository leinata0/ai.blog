import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Calendar, Layers3, Rss } from 'lucide-react'

import { fetchSeriesDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import { buildSubscriptionCenterHref } from '../utils/subscriptionLinks'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import {
  getContentTypeLabel,
  getSeriesDescription,
  getSeriesTitle,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

export default function SeriesDetailPage() {
  const { settings } = useSite()
  const { slug } = useParams()
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(true)
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const seriesTitle = getSeriesTitle(series || { slug })
  const seriesPath = `/series/${slug || ''}`
  const rssUrl = `/api/feeds/series/${encodeURIComponent(slug || '')}.xml`
  const starterPost = series?.posts?.[0] || null
  const quickReads = (series?.posts || []).slice(0, 3)
  const jsonLd = useMemo(() => ([
    buildCollectionPageJsonLd({
      siteUrl,
      name: seriesTitle,
      description: getSeriesDescription(series || { slug }),
      path: seriesPath,
      image: series?.cover_image || '',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '系列', path: '/series' },
        { name: seriesTitle, path: seriesPath },
      ],
    }),
  ]), [series, seriesPath, seriesTitle, siteUrl])

  useEffect(() => {
    fetchSeriesDetail(slug)
      .then((payload) => {
        setSeries(payload)
        document.title = `${getSeriesTitle(payload)} - AI 资讯观察`
      })
      .catch(() => setSeries(null))
      .finally(() => setLoading(false))
  }, [slug])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title={`${seriesTitle} - AI 资讯观察`}
        description={getSeriesDescription(series || { slug })}
        path={seriesPath}
        image={series?.cover_image || starterPost?.cover_image || ''}
        jsonLd={jsonLd}
        rssUrl={rssUrl}
      />
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
        <Link to="/series" className="mb-6 inline-flex items-center gap-2 text-sm" style={{ color: 'var(--text-faint)' }}>
          <ArrowLeft size={14} />
          返回系列列表
        </Link>

        {loading ? (
          <LoadingSkeletonSet count={2} className="space-y-6" minHeight="18rem" />
        ) : !series ? (
          <EmptyStatePanel
            title="该系列暂时不可用"
            description="稍后再试，或先回到系列页继续浏览其他阅读路径。"
          />
        ) : (
          <div className="space-y-8">
            <motion.section initial="hidden" animate="visible" variants={motionItemVariants}>
              <CoverCard
                image={series.cover_image}
                imageAlt={seriesTitle}
                overlay
                eyebrow="系列主线"
                title={seriesTitle}
                description={getSeriesDescription(series)}
                meta={[
                  `${series.post_count || series.posts?.length || 0} 篇内容`,
                  Array.isArray(series.content_types) && series.content_types.length > 0
                    ? series.content_types.map((item) => getContentTypeLabel(item)).join(' / ')
                    : '持续更新',
                ]}
                footer={(
                  <div className="flex flex-wrap gap-3">
                    <Link
                      to={buildSubscriptionCenterHref({ seriesSlug: slug })}
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.22)' }}
                    >
                      订阅这个系列
                      <ArrowRight size={14} />
                    </Link>
                    <a
                      href={rssUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-transform duration-200 hover:-translate-y-0.5"
                      style={{ backgroundColor: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }}
                    >
                      <Rss size={15} />
                      系列 RSS
                    </a>
                  </div>
                )}
              />
            </motion.section>

            <motion.section initial="hidden" animate="visible" variants={motionContainerVariants} className="grid gap-4 lg:grid-cols-2">
              <motion.article variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-6 py-6">
                <EditorialSectionHeader
                  eyebrow="起步阅读"
                  title="从哪一篇开始最合适"
                  titleClassName="!text-[1.45rem]"
                  description={starterPost
                    ? `如果你第一次进入这个系列，建议先从《${starterPost.title}》开始。`
                    : '当系列补齐后，这里会优先给出最适合进入的第一篇。'}
                />
                {starterPost ? (
                  <Link
                    to={`/posts/${starterPost.slug}`}
                    className="mt-4 block rounded-[1.2rem] border px-4 py-4 transition-all duration-200 hover:-translate-y-0.5"
                    style={{ borderColor: 'var(--border-muted)', backgroundColor: 'var(--bg-canvas)' }}
                  >
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {starterPost.title}
                    </div>
                    <div className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                      {starterPost.summary}
                    </div>
                  </Link>
                ) : null}
              </motion.article>

              <motion.article variants={motionItemVariants} className="editorial-panel rounded-[1.8rem] px-6 py-6">
                <EditorialSectionHeader
                  eyebrow="快速读懂"
                  title="先读这 3 篇就够快"
                  titleClassName="!text-[1.45rem]"
                  description="如果你想更快理解这个栏目在持续组织什么，可以先从这几篇开始建立阅读路径。"
                />
                <div className="mt-4 space-y-3">
                  {quickReads.map((post) => (
                    <Link
                      key={post.slug}
                      to={`/posts/${post.slug}`}
                      className="block rounded-[1.2rem] border border-transparent px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
                    >
                      <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {post.title}
                      </div>
                      <div className="mt-1 text-xs leading-6" style={{ color: 'var(--text-faint)' }}>
                        {post.summary}
                      </div>
                    </Link>
                  ))}
                </div>
              </motion.article>
            </motion.section>

            <motion.section initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
              <EditorialSectionHeader
                eyebrow="系列文章"
                title="沿着这条阅读路径继续往下看"
                description="系列页会把同一栏目下的内容按时间和节奏组织在一起，方便连续阅读。"
              />

              {(series.posts || []).length > 0 ? (series.posts || []).map((post) => (
                <motion.article key={post.slug} variants={motionItemVariants} className="editorial-card rounded-[1.8rem] border px-6 py-5">
                  <Link to={`/posts/${post.slug}`} className="block">
                    <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDate(post.created_at)}
                      </span>
                      {post.coverage_date ? <span>覆盖日期 {post.coverage_date}</span> : null}
                      {post.content_type ? <span>{getContentTypeLabel(post.content_type)}</span> : null}
                    </div>
                    <h2 className="mt-3 font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {post.title}
                    </h2>
                    <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                      {post.summary}
                    </p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                      进入文章
                      <ArrowRight size={14} />
                    </div>
                  </Link>
                </motion.article>
              )) : (
                <EmptyStatePanel
                  title="这个系列还没有公开文章"
                  description="当新的内容归入这个系列后，会优先展示在这里。"
                  icon={Layers3}
                />
              )}
            </motion.section>
          </div>
        )}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
