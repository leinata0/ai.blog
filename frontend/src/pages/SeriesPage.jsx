import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Layers3 } from 'lucide-react'

import { fetchSeriesList } from '../api/posts'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import {
  getSeriesDescription,
  getSeriesTitle,
  hoverLift,
  motionContainerVariants,
  motionItemVariants,
} from '../utils/contentPresentation'

export default function SeriesPage() {
  const [seriesList, setSeriesList] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '系列 - 极客开发日志'
    fetchSeriesList()
      .then(setSeriesList)
      .catch(() => setSeriesList([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <motion.div initial="hidden" animate="visible" variants={motionItemVariants} className="mb-10">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>内容系列</h1>
          <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
            把日报、周报与专题文章整理成长期可追踪的内容主线。
          </p>
        </motion.div>

        {loading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-72 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))}
          </div>
        ) : seriesList.length === 0 ? (
          <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <p style={{ color: 'var(--text-faint)' }}>系列内容正在整理中。</p>
          </div>
        ) : (
          <motion.div initial="hidden" animate="visible" variants={motionContainerVariants} className="grid gap-6 md:grid-cols-2">
            {seriesList.map((series) => (
              <motion.article
                key={series.slug}
                variants={motionItemVariants}
                whileHover={hoverLift}
                className="editorial-card group overflow-hidden rounded-3xl border"
                style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', boxShadow: 'var(--card-shadow)' }}
              >
                <Link to={`/series/${series.slug}`} className="block">
                  {series.cover_image ? (
                    <div className="editorial-cover h-44 overflow-hidden">
                      <img
                        src={proxyImageUrl(series.cover_image)}
                        alt={getSeriesTitle(series)}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <div className="space-y-4 p-6">
                    <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(37, 99, 235, 0.12)', color: '#2563eb' }}>
                      <Layers3 size={12} />
                      系列
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{getSeriesTitle(series)}</h2>
                      <p className="mt-2 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                        {getSeriesDescription(series)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-faint)' }}>
                      <span>{series.post_count || series.posts?.length || 0} 篇内容</span>
                      <span className="inline-flex items-center gap-1 text-[var(--accent)]">
                        查看系列
                        <ArrowRight size={14} />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.article>
            ))}
          </motion.div>
        )}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
