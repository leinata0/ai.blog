import { Link } from 'react-router-dom'

import { getContentTypeLabel } from '../utils/contentPresentation'

export default function ContinueReadingSection({
  items = [],
  title = '继续阅读',
  emptyText = '读过的文章会在这里形成回访入口。',
}) {
  return (
    <section
      className="editorial-panel rounded-3xl px-5 py-5"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <Link
              key={item.slug}
              to={`/posts/${item.slug}`}
              className="block rounded-2xl border border-transparent px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:bg-[var(--bg-canvas)]"
            >
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                {getContentTypeLabel(item.content_type)}
                {item.topic_key ? ` · ${item.topic_display_title || item.topic_key}` : ''}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6" style={{ color: 'var(--text-faint)' }}>{emptyText}</p>
      )}
    </section>
  )
}
