import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Compass, Flame, Sparkles } from 'lucide-react'

import { fetchTopics, prefetchTopicDetail } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import SeoMeta from '../components/SeoMeta'
import TechTopics from '../components/collections/TechTopics'
import CinematicNavigation from '../components/news/cinematic/CinematicNavigation'
import { useNewsStyle } from '../hooks/useNewsStyle'
import usePublicCollection from '../hooks/usePublicCollection'
import CollectionRefreshNotice from '../components/CollectionRefreshNotice'
import { useSite } from '../contexts/SiteContext'
import { formatDate } from '../utils/date'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
} from '../utils/structuredData'
import {
  getTopicBadgeLabel,
  getTopicDescription,
  getTopicTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

export default function TopicsPage() {
  const { settings } = useSite()
  const { newsStyle } = useNewsStyle()
  const { items: topics, loading, error, refreshError, retry } = usePublicCollection({
    route: '/topics',
    errorMessage: '主题暂时无法加载，请稍后重试。',
    legacyOptions: { staleWhileRevalidate: true, cacheTtl: 30000, staleTtl: 120000 },
    load: async (options) => {
      const payload = await fetchTopics({ limit: 24 }, options)
      return Array.isArray(payload?.items) ? payload.items : []
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
      name: '主题追踪',
      description: '围绕公司、模型、产品方向和事件链持续聚合内容主线的主题总览页。',
      path: '/topics',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [
        { name: '首页', path: '/' },
        { name: '主题', path: '/topics' },
      ],
    }),
  ]), [siteUrl])

  function prefetchTopic(topicKey) {
    prefetchTopicDetail(topicKey, { staleWhileRevalidate: true, cacheTtl: 120000, staleTtl: 300000 })
  }

  return (
    <main id="main-content" className={newsStyle === 'tech' ? 'cinematic-section min-h-screen' : 'min-h-screen'} style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <SeoMeta
        title="主题追踪 - AI 资讯观察"
        description="围绕公司、模型、产品方向和事件链持续聚合内容主线，帮助你从单点消息回到长期变化。"
        path="/topics"
        jsonLd={jsonLd}
      />
      {newsStyle === 'tech' ? <CinematicNavigation /> : <Navbar />}
      <CollectionRefreshNotice error={refreshError} onRetry={retry} />
      {newsStyle === 'tech' ? <TechTopics topics={topics} loading={loading} error={error} onRetry={retry} onPrefetch={prefetchTopic} /> : <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10" data-ui="paper-topic-index">
        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionItemVariants}
          className="editorial-panel rounded-[2rem] px-8 py-8"
        >
          <EditorialSectionHeader
            eyebrow="主题总览"
            titleAs="h1"
            title="用主题，把分散消息串成长期主线"
            description="这里聚合的是“内容在讲什么”。日报、周报和系列里的相关文章会沿着同一条主题继续沉淀，帮助你更快看清某家公司、模型或产品方向的持续变化。"
          />
        </motion.section>

        <motion.section
          initial="hidden"
          animate="visible"
          variants={motionContainerVariants}
          className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
        >
          {loading ? (
            <LoadingSkeletonSet count={6} className="contents" itemClassName="rounded-[1.8rem]" minHeight="20rem" />
          ) : error ? (
            <div role="alert" className="md:col-span-2 xl:col-span-3 editorial-panel rounded-[1.8rem] p-6">
              <p>{error}</p><button type="button" onClick={retry} className="mt-4 min-h-11 px-4" style={{ color: 'var(--accent)' }}>重新加载主题</button>
            </div>
          ) : topics.length > 0 ? (
            topics.map((topic) => (
              <motion.div
                key={topic.topic_key}
                variants={motionItemVariants}
                whileHover={hoverLift}
                onMouseEnter={() => prefetchTopic(topic.topic_key)}
                onFocus={() => prefetchTopic(topic.topic_key)}
              >
                <CoverCard
                  to={`/topics/${encodeURIComponent(topic.topic_key)}`}
                  image={topic.cover_image}
                  imageAlt={getTopicTitle(topic)}
                  eyebrow={topic.is_featured ? '推荐主题' : '主题主线'}
                  badge={(
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
                      style={{
                        backgroundColor: topic.is_featured ? 'var(--highlight-soft)' : 'var(--accent-soft)',
                        color: topic.is_featured ? 'var(--highlight-text)' : 'var(--accent)',
                      }}
                    >
                      {topic.is_featured ? <Sparkles size={12} /> : <Flame size={12} />}
                      {getTopicBadgeLabel(topic)}
                    </span>
                  )}
                  title={getTopicTitle(topic)}
                  description={getTopicDescription(topic)}
                  meta={[
                    topic.post_count ? `${topic.post_count} 篇文章` : '主题页',
                    topic.source_count ? `${topic.source_count} 条来源` : '持续更新',
                    topic.latest_post_at ? `最近更新于 ${formatDate(topic.latest_post_at)}` : '持续追踪中',
                  ]}
                />
              </motion.div>
            ))
          ) : (
            <div className="md:col-span-2 xl:col-span-3">
              <EmptyStatePanel
                title="当前还没有可展示的主题"
                description="等待带 topic_key 的文章发布后，这里会自动汇总为主题入口。"
                icon={Compass}
              />
            </div>
          )}
        </motion.section>
      </div>}
      <Footer />
      <BackToTop />
    </main>
  )
}
