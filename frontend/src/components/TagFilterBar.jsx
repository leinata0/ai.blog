export default function TagFilterBar({ tags, activeTag, onTagSelect }) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => onTagSelect('')}
        className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] ${
          activeTag === ''
            ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
            : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
        }`}
      >
        all
      </button>
      {tags.map((tag) => (
        <button
          key={tag.slug}
          type="button"
          onClick={() => onTagSelect(tag.slug)}
          className={`rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] ${
            activeTag === tag.slug
              ? 'border-emerald-400 bg-emerald-400 text-zinc-950'
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
          }`}
        >
          {tag.name}
        </button>
      ))}
    </div>
  )
}
