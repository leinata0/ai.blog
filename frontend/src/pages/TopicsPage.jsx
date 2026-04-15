import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Flame, Sparkles } from 'lucide-react'

import { fetchTopics } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import { formatDate } from '../utils/date'

export default function TopicsPage() {
  const [topics, setTopics] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    document.title = '主题 - 极客开发日志'
    fetchTopics({ sort: 'activity', page_size: 24 })
      .then((payload) => setTopics(Array.isArray(payload?.items) ? payload.items : []))
      .catch(() => setTopics([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-6xl px-6 py-16 sm:px-10">
        <section className="rounded-3xl px-8 py-8" style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#2563eb' }}>
            <Compass size={16} />
            主题总览
          </div>
          <h1 className="mt-3 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>围绕主题而不是单篇文章阅读</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
            把日报、周报和系列内容沉淀成主题主线，持续追踪 AI 产品、公司和技术方向的变化。
          </p>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            [1, 2, 3, 4, 5, 6].map((item) => (
              <div key={item} className="h-44 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))
          ) : topics.map((topic) => (
            <Link
              key={topic.topic_key}
              to={`/topics/${topic.topic_key}`}
              className="block rounded-3xl px-6 py-6"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: topic.is_featured ? 'rgba(37,99,235,0.12)' : 'var(--accent-soft)', color: topic.is_featured ? '#2563eb' : 'var(--accent)' }}>
                  {topic.is_featured ? <Sparkles size={12} /> : <Flame size={12} />}
                  {topic.is_featured ? '编辑推荐' : '持续追踪'}
                </span>
                {topic.avg_quality_score ? (
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>均分 {topic.avg_quality_score}</span>
                ) : null}
              </div>
              <h2 className="mt-4 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{topic.display_title}</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                {topic.description || '查看这条主线下的日报、周报与专题延展。'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
                {topic.post_count ? <span>{topic.post_count} 篇文章</span> : null}
                {topic.source_count ? <span>{topic.source_count} 个来源</span> : null}
                {topic.latest_post_at ? <span>更新于 {formatDate(topic.latest_post_at)}</span> : null}
              </div>
            </Link>
          ))}
        </section>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
