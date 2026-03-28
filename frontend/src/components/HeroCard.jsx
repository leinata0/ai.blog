export default function HeroCard({ post }) {
  return (
    <a href={`/posts/${post.slug}`} className="hero-card block p-8 sm:p-10">
      {/* Row: tags + read time hint — monospace */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {post.tags.map((tag) => (
          <span key={tag.slug} className="term-tag">
            {tag.name}
          </span>
        ))}
        <span
          className="font-terminal text-fluid-xs tracking-mono-normal ml-auto hidden sm:inline"
          style={{ color: 'var(--text-faint)' }}
        >
          latest
        </span>
      </div>

      {/* Title — maximum visual weight */}
      <h2
        className="text-fluid-3xl font-extrabold tracking-tight mb-4"
        style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}
      >
        {post.title}
      </h2>

      {/* Summary */}
      <p
        className="max-w-2xl text-fluid-base leading-relaxed mb-6"
        style={{ color: 'var(--text-secondary)' }}
      >
        {post.summary}
      </p>

      {/* Read more — monospace link */}
      <span
        className="font-terminal text-fluid-sm font-medium tracking-mono-normal"
        style={{ color: 'var(--accent)' }}
      >
        $ read &rarr;
      </span>
    </a>
  )
}
