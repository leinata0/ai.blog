import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { fetchDiscover, fetchPosts } from '../api/posts'
import { formatDate } from '../utils/date'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

const COPY = {
  daily_brief: {
    title: 'AI Daily Brief',
    description: '聚合当天值得跟踪的 AI 日更内容。',
  },
  weekly_review: {
    title: 'AI Weekly Review',
    description: '从一周视角看产品、模型和产业节奏变化。',
  },
}

export default function ContentTypePage({ contentType }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const copy = COPY[contentType] || COPY.daily_brief

  useEffect(() => {
    document.title = `${copy.title} - 极客开发日志`
    setLoading(true)
    fetchDiscover({ content_type: contentType })
      .then((payload) => setPosts(payload.items || []))
      .catch(async () => {
        const fallback = await fetchPosts()
        setPosts((fallback.items || []).filter((post) => post.content_type === contentType))
      })
      .finally(() => setLoading(false))
  }, [contentType, copy.title])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />
      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>{copy.title}</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{copy.description}</p>
        </div>

        <div className="space-y-4">
          {loading ? (
            [1, 2, 3].map((item) => (
              <div key={item} className="h-28 rounded-3xl skeleton-pulse" style={{ backgroundColor: 'var(--bg-surface)' }} />
            ))
          ) : posts.length === 0 ? (
            <div className="rounded-3xl px-8 py-10" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <p style={{ color: 'var(--text-faint)' }}>这里暂时还没有内容。</p>
            </div>
          ) : posts.map((post) => (
            <Link
              key={post.slug}
              to={`/posts/${post.slug}`}
              className="block rounded-3xl px-6 py-5"
              style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
            >
              <div className="text-xs" style={{ color: 'var(--text-faint)' }}>{formatDate(post.created_at)}</div>
              <h2 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
            </Link>
          ))}
        </div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
