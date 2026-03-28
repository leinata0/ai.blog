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
      <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
        <div className="mx-auto max-w-3xl">
          <ArticleSkeleton />
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-500/30 bg-red-500/10 p-8 text-red-200">
          {error}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
      <article className="mx-auto flex max-w-3xl flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900/70 p-8">
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-emerald-300"
            >
              {tag.name}
            </span>
          ))}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{post.title}</h1>
        <p className="text-sm leading-7 text-zinc-400">{post.summary}</p>
        <div className="prose prose-invert max-w-none whitespace-pre-wrap text-zinc-200">{post.content_md}</div>
      </article>
    </main>
  )
}
