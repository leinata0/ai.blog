import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Calendar, Layers3 } from 'lucide-react'

import { fetchSeriesDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import CoverCard from '../components/CoverCard'
import EditorialSectionHeader from '../components/EditorialSectionHeader'
import EmptyStatePanel from '../components/EmptyStatePanel'
import LoadingSkeletonSet from '../components/LoadingSkeletonSet'
import {
  getContentTypeLabel,
  getSeriesDescription,
  getSeriesTitle,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

export default function SeriesDetailPage() {
  const { slug } = useParams()
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(true)

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
                imageAlt={getSeriesTitle(series)}
                overlay
                eyebrow="系列主线"
                title={getSeriesTitle(series)}
                description={getSeriesDescription(series)}
                meta={[
                  `${series.post_count || series.posts?.length || 0} 篇内容`,
                  Array.isArray(series.content_types) && series.content_types.length > 0
                    ? series.content_types.map((item) => getContentTypeLabel(item)).join(' / ')
                    : '持续更新',
                ]}
              />
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
