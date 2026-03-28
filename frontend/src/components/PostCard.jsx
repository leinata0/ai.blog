/* PostCard — generic single-post display (used in lists when Hero/Grid split is not needed) */
export default function PostCard({ post }) {
  return (
    <article data-ui="post-card" className="grid-card block">
      <a href={`/posts/${post.slug}`} className="block">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {post.tags.map((tag) => (
            <span key={tag.slug} className="term-tag">
              {tag.name}
            </span>
          ))}
        </div>
        <h2
          className="text-fluid-xl font-bold tracking-tight mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          {post.title}
        </h2>
        <p
          className="max-w-2xl text-fluid-sm leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {post.summary}
        </p>
      </a>
    </article>
  )
}
