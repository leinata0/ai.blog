export default function GridCard({ post }) {
  return (
    <a href={`/posts/${post.slug}`} className="grid-card block">
      {/* Tags — monospace */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {post.tags.map((tag) => (
          <span key={tag.slug} className="term-tag">
            {tag.name}
          </span>
        ))}
      </div>

      {/* Title */}
      <h2
        className="text-fluid-xl font-bold tracking-tight mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {post.title}
      </h2>

      {/* Summary — compact */}
      <p
        className="text-fluid-sm leading-relaxed mb-5"
        style={{ color: 'var(--text-secondary)' }}
      >
        {post.summary}
      </p>

      {/* Link — monospace */}
      <span
        className="font-terminal text-fluid-xs font-medium tracking-mono-normal"
        style={{ color: 'var(--accent)' }}
      >
        $ read &rarr;
      </span>
    </a>
  )
}
