export default function PostCard({ post }) {
  return (
    <article
      data-ui="post-card"
      className="rounded-[28px] border p-8 transition-colors"
      style={{
        borderColor: 'var(--border-muted)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <a href={`/posts/${post.slug}`} className="block space-y-5">
        <div className="space-y-3">
          <h2 className="text-[1.9rem] font-semibold tracking-[-0.03em]" style={{ color: 'var(--text-primary)' }}>{post.title}</h2>
          <p className="max-w-2xl text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{post.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em]"
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
      </a>
    </article>
  )
}
