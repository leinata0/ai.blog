import { Link } from 'react-router-dom'

export default function RecentTopicsSection({
  items = [],
  title = '最近关注主题',
  emptyText = '关注或阅读过的主题会在这里出现。',
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
              key={item.topic_key}
              to={`/topics/${item.topic_key}`}
              className="block rounded-2xl px-4 py-3 transition-colors duration-200 hover:bg-[var(--bg-canvas)]"
            >
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {item.display_title || item.topic_key}
              </div>
              <div className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                {item.latest_post_at
                  ? `最近活跃：${new Date(item.latest_post_at).toLocaleDateString('zh-CN')}`
                  : '主题主线'}
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
