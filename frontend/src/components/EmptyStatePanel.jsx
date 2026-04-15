import { Sparkles } from 'lucide-react'

export default function EmptyStatePanel({
  title = '这里暂时还没有内容',
  description = '新内容会随着更新陆续出现在这里。',
  icon: Icon = Sparkles,
  className = '',
  children,
}) {
  return (
    <div className={`empty-state-panel ${className}`.trim()}>
      <div className="empty-state-panel__icon">
        <Icon size={18} />
      </div>
      <h3 className="empty-state-panel__title">{title}</h3>
      <p className="empty-state-panel__description">{description}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  )
}
