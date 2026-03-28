export default function PostCard({ post }) {
  return (
    <article className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <a href={`/posts/${post.slug}`} className="block space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">{post.title}</h2>
        <p className="text-sm leading-6 text-zinc-400">{post.summary}</p>
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag.slug}
              className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-emerald-300"
            >
              {tag.name}
            </span>
          ))}
        </div>
      </a>
    </article>
  )
}
