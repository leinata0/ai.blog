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
    <main data-ui="home-shell" className="min-h-screen px-6 py-20" style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)' }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-[0.32em]" style={{ color: 'var(--accent-strong)' }}>AI DEV LOG</p>
          <h1 className="max-w-3xl text-5xl font-semibold tracking-[-0.04em] sm:text-6xl">Minimal blog for builders</h1>
          <p className="max-w-2xl text-base leading-8" style={{ color: 'var(--text-secondary)' }}>
            Notes on React, FastAPI, and the systems behind AI-native products.
          </p>
        </header>

        <TagFilterBar tags={tags} activeTag={tag} onTagSelect={setTag} />

        <section className="grid gap-6 sm:gap-7">
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
