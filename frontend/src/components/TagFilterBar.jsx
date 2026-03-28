export default function TagFilterBar({ tags, activeTag, onTagSelect }) {
  return (
    <div data-ui="filter-bar" className="flex flex-wrap items-center gap-2">
      {/* Prompt prefix */}
      <span
        className="font-terminal text-fluid-xs tracking-mono-normal mr-1"
        style={{ color: 'var(--text-faint)' }}
      >
        filter:
      </span>

      <FilterButton
        label="*"
        active={activeTag === ''}
        onClick={() => onTagSelect('')}
      />
      {tags.map((tag) => (
        <FilterButton
          key={tag.slug}
          label={tag.name}
          active={activeTag === tag.slug}
          onClick={() => onTagSelect(tag.slug)}
        />
      ))}
    </div>
  )
}

function FilterButton({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`term-tag cursor-pointer ${active ? 'term-tag--active' : ''}`}
    >
      {label}
    </button>
  )
}
