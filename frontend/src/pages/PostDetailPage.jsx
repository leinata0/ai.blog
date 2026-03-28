import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPostDetail } from '../api/posts'
import ArticleSkeleton from '../components/ArticleSkeleton'

export default function PostDetailPage({ slug: overrideSlug }) {
  const params = useParams()
  const slug = overrideSlug ?? params.slug
  const [post, setPost] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    fetchPostDetail(slug)
      .then((data) => {
        if (!active) return
        setPost(data)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError('Post not found')
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [slug])

  if (loading) {
    return (
      <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <div className="mx-auto max-w-3xl">
          <ArticleSkeleton />
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
        <div
          data-ui="detail-error"
          className="mx-auto max-w-3xl rounded-[28px] border p-8"
          style={{
            borderColor: 'var(--danger-border)',
            backgroundColor: 'var(--danger-soft)',
            color: 'var(--text-primary)',
          }}
        >
          {error}
        </div>
      </main>
    )
  }

  return (
    <main data-ui="detail-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <article
        data-ui="detail-article"
        className="mx-auto flex max-w-3xl flex-col gap-8 rounded-[32px] border p-10 sm:p-12"
        style={{
          borderColor: 'var(--border-muted)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.22em]"
              style={{
                borderColor: 'rgba(143, 170, 122, 0.28)',
                backgroundColor: 'var(--accent-soft)',
                color: 'var(--accent-strong)',
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">{post.title}</h1>
          <p className="max-w-2xl text-base leading-8" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </div>
        <div className="max-w-none whitespace-pre-wrap text-[15px] leading-8 sm:text-base" style={{ color: 'var(--text-secondary)' }}>
          {post.content_md}
        </div>
      </article>
    </main>
  )
}
