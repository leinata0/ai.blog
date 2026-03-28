export default function ArticleSkeleton() {
  return (
    <div
      className="animate-pulse rounded-[28px] border p-8"
      style={{
        borderColor: 'var(--border-muted)',
        backgroundColor: 'var(--bg-surface)',
      }}
    >
      <div className="mb-5 h-7 w-1/3 rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
      <div className="mb-3 h-4 w-full rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
      <div className="h-4 w-2/3 rounded" style={{ backgroundColor: 'var(--bg-surface-alt)' }} />
    </div>
  )
}
