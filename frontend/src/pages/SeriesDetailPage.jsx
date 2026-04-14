import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Calendar } from 'lucide-react'

import { fetchSeriesDetail } from '../api/posts'
import { formatDate } from '../utils/date'
import { proxyImageUrl } from '../utils/proxyImage'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

export default function SeriesDetailPage() {
  const { slug } = useParams()
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSeriesDetail(slug)
      .then((payload) => {
        setSeries(payload)
        document.title = `${payload.title || 'Series'} - 极客开发日志`
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
            <section className="overflow-hidden rounded-3xl" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
              {series.cover_image ? (
                <div className="h-56 overflow-hidden">
                  <img src={proxyImageUrl(series.cover_image)} alt={series.title} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ) : null}
              <div className="space-y-4 p-8">
                <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{series.title}</h1>
                <p className="text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                  {series.description || '围绕一个长期主题持续输出的内容集合。'}
                </p>
              </div>
            </section>

            <section className="space-y-4">
              {(series.posts || []).map((post) => (
                <Link
                  key={post.slug}
                  to={`/posts/${post.slug}`}
                  className="block rounded-3xl px-6 py-5"
                  style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
                >
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={12} />
                      {formatDate(post.created_at)}
                    </span>
                    {post.coverage_date ? <span>覆盖日期 {post.coverage_date}</span> : null}
                  </div>
                  <h2 className="mt-3 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
                  <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
                </Link>
              ))}
            </section>
          </div>
        )}
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
