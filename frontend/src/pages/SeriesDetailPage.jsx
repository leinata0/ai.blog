import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Calendar, Layers3 } from 'lucide-react'

import { fetchSeriesDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
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
        document.title = `${payload.title || '内容系列'}`
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
          <div className="space-y-6">
            <div className="h-52 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            <div className="h-32 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
          </div>
        ) : !series ? (
          <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <p style={{ color: 'var(--text-faint)' }}>该系列暂时不可用。</p>
          </div>
        ) : (
          <div className="space-y-8">
            <motion.section
              initial="hidden"
              animate="visible"
              variants={motionItemVariants}
              className="editorial-panel overflow-hidden rounded-3xl"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              {series.cover_image ? (
                <div className="editorial-cover h-64 overflow-hidden">
                  <img src={proxyImageUrl(series.cover_image)} alt={getSeriesTitle(series)} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ) : null}
              <div className="space-y-4 p-8">
                <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}>
                  <Layers3 size={12} />
                  系列主线
                </div>
                <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{getSeriesTitle(series)}</h1>
                <p className="text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                  {getSeriesDescription(series)}
                </p>
                <div className="flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                  <span>{series.post_count || series.posts?.length || 0} 篇内容</span>
                  {Array.isArray(series.content_types) && series.content_types.length > 0
                    ? <span>{series.content_types.map((item) => getContentTypeLabel(item)).join(' / ')}</span>
                    : null}
                </div>
              </div>
            </motion.section>

            <motion.section initial="hidden" animate="visible" variants={motionContainerVariants} className="space-y-4">
              {(series.posts || []).map((post) => (
                <motion.article key={post.slug} variants={motionItemVariants} className="editorial-card rounded-3xl border px-6 py-5" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}>
                  <Link to={`/posts/${post.slug}`} className="block">
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={12} />
                        {formatDate(post.created_at)}
                      </span>
                      {post.coverage_date ? <span>覆盖日期 {post.coverage_date}</span> : null}
                      {post.content_type ? <span>{getContentTypeLabel(post.content_type)}</span> : null}
                    </div>
                    <h2 className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
                    <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
                  </Link>
                </motion.article>
              ))}
            </motion.section>
          </div>
        )}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
