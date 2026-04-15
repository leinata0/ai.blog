import { Link } from 'react-router-dom'

export default function ContinueReadingSection({
  items = [],
  title = '继续阅读',
  emptyText = '读过的文章会在这里形成回访入口。',
}) {
  return (
    <section
      className="rounded-3xl px-5 py-5"
      style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--card-shadow)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      {items.length > 0 ? (
        <div className="mt-4 space-y-3">
          {items.map((item) => (
            <Link
              key={item.slug}
              to={`/posts/${item.slug}`}
              className="block rounded-2xl px-4 py-3 transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
            >
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                {item.content_type === 'weekly_review' ? '周报' : '日报'}
                {item.topic_key ? ` · ${item.topic_key}` : ''}
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
