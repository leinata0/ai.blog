import { useEffect, useMemo, useState } from 'react'
import { fetchPosts } from '../api/posts'
import PostCard from '../components/PostCard'
import TagFilterBar from '../components/TagFilterBar'
import ArticleSkeleton from '../components/ArticleSkeleton'

export default function HomePage() {
  const [tag, setTag] = useState('')
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchPosts(tag || undefined).then((items) => {
      if (!active) return
      setPosts(items)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [tag])

  const tags = useMemo(() => {
    const map = new Map()
    posts.forEach((post) => {
      post.tags.forEach((item) => map.set(item.slug, item))
    })
    return Array.from(map.values())
  }, [posts])

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <header className="space-y-4">
          <p className="text-xs uppercase tracking-[0.32em] text-emerald-400">AI DEV LOG</p>
          <h1 className="text-5xl font-semibold tracking-tight">Minimal blog for builders</h1>
          <p className="max-w-2xl text-sm leading-7 text-zinc-400">
            Notes on React, FastAPI, and the systems behind AI-native products.
          </p>
        </header>

        <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />

        <section className="grid gap-5">
          {loading ? (
            <>
              <ArticleSkeleton />
              <ArticleSkeleton />
            </>
          ) : (
            posts.map((post) => <PostCard key={post.slug} post={post} />)
          )}
        </section>
      </div>
    </main>
  )
}
