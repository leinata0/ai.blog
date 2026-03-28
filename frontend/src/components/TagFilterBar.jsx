export default function TagFilterBar({ tags, activeTag, onTagSelect }) {
  const baseStyle = {
    borderColor: 'var(--border-muted)',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
  }

  const activeStyle = {
    borderColor: 'rgba(143, 170, 122, 0.35)',
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text-primary)',
  }

  return (
    <div data-ui="filter-bar" className="flex flex-wrap gap-3">
      <button
        type="button"
        onClick={() => onTagSelect('')}
        className="rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition-colors"
        style={activeTag === '' ? activeStyle : baseStyle}
      >
        all
      </button>
      {tags.map((tag) => (
        <button
          key={tag.slug}
          type="button"
          onClick={() => onTagSelect(tag.slug)}
          className="rounded-full border px-4 py-2 text-xs uppercase tracking-[0.24em] transition-colors"
          style={activeTag === tag.slug ? activeStyle : baseStyle}
        >
          {tag.name}
        </button>
      ))}
    </div>
  )
}
