import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'

import { fetchSeriesList, prefetchSeriesDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import SeriesEditorialStack from '../components/SeriesEditorialStack'
import TechSeries from '../components/collections/TechSeries'
import CinematicNavigation from '../components/news/cinematic/CinematicNavigation'
import { useNewsStyle } from '../hooks/useNewsStyle'
import usePublicCollection from '../hooks/usePublicCollection'
import CollectionRefreshNotice from '../components/CollectionRefreshNotice'
import { useSite } from '../contexts/SiteContext'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import { motionItemVariants } from '../utils/contentPresentation'

export default function SeriesPage() {
  const { settings } = useSite()
  const { newsStyle } = useNewsStyle()
  const { items: seriesList, loading, error, refreshError, retry: loadSeries } = usePublicCollection({
    route: '/series',
    errorMessage: '系列内容加载失败，请稍后重试。',
    load: async (options) => {
      const items = await fetchSeriesList({}, options)
      return Array.isArray(items) ? items : []
    },
  })
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])
  const jsonLd = useMemo(() => ([
    buildCollectionPageJsonLd({
      siteUrl,
      name: '内容系列',
      description: '把日报、周报与专题文章整理成更容易持续阅读的栏目路径。',
      path: '/series',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '系列', path: '/series' },
      ],
    }),
  ]), [siteUrl])

  function prefetchSeries(slug) {
    prefetchSeriesDetail(slug, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  return (
    <main id="main-content" className={newsStyle === 'tech' ? 'cinematic-section min-h-screen' : 'min-h-screen'} style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title="内容系列 - AI 资讯观察"
        description="把日报、周报与专题文章整理成更容易持续阅读的栏目路径，帮助你沿着同一条阅读节奏继续往下看。"
        path="/series"
        jsonLd={jsonLd}
      />
      {newsStyle === 'tech' ? <CinematicNavigation /> : <Navbar />}
      <CollectionRefreshNotice error={refreshError} onRetry={loadSeries} />
      {newsStyle === 'tech' ? <TechSeries items={seriesList} loading={loading} error={error} onRetry={loadSeries} onPrefetch={prefetchSeries} /> : <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10" data-ui="paper-series-index">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
        >
          <EditorialSectionHeader
            eyebrow="系列总览"
            titleAs="h1"
            title="把文章整理成更容易持续阅读的路径"
            description="系列强调的是“如何组织阅读”。它会把日报、周报与专题文章串成长期栏目，帮助你从单篇阅读走向整条内容主线。"
            actionLabel="去发现页继续浏览"
            actionTo="/discover"
            actionIcon={ArrowRight}
          />
        </motion.section>

        <div className="mt-8">
          {loading ? (
            <LoadingSkeletonSet count={2} className="space-y-4" minHeight="22rem" />
          ) : error ? (
            <div
              role="alert"
              data-ui="series-page-error"
              className="rounded-[1.8rem] px-6 py-6"
              style={{ backgroundColor: 'var(--danger-soft)' }}
            >
              <p className="text-sm font-medium" style={{ color: 'var(--danger-text)' }}>{error}</p>
              <button
                type="button"
                onClick={loadSeries}
                className="mt-4 min-h-11 rounded-xl px-5 text-sm font-semibold text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                重新加载系列
              </button>
            </div>
          ) : (
            <SeriesEditorialStack
              items={seriesList}
              mode="full"
              emptyText="系列内容正在整理中，稍后这里会出现完整的阅读路径。"
              dataUi="series-page-showcase"
            />
          )}
        </div>
      </div>}
      <Footer />
      <BackToTop />
    </main>
  )
}
