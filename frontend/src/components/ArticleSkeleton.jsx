export default function ArticleSkeleton({ size = 'hero' }) {
  if (size === 'hero') {
    return (
      <div
        className="skeleton-pulse rounded-sharp border p-8 sm:p-10"
        style={{ borderColor: 'var(--border-muted)', background: 'var(--bg-canvas-deep)' }}
      >
        {/* Tag placeholder */}
        <div className="flex gap-2 mb-6">
          <div className="h-5 w-14 rounded-sharp" style={{ background: 'var(--bg-surface)' }} />
          <div className="h-5 w-18 rounded-sharp" style={{ background: 'var(--bg-surface)' }} />
        </div>
        {/* Title */}
        <div className="h-10 w-4/5 rounded-sharp mb-4" style={{ background: 'var(--bg-surface)' }} />
        {/* Summary lines */}
        <div className="h-4 w-full rounded-sharp mb-2" style={{ background: 'var(--bg-surface)' }} />
        <div className="h-4 w-3/4 rounded-sharp mb-6" style={{ background: 'var(--bg-surface)' }} />
        {/* CTA */}
        <div className="h-4 w-20 rounded-sharp" style={{ background: 'var(--bg-surface)' }} />
      </div>
    )
  }

  /* Grid size */
  return (
    <div
      className="skeleton-pulse rounded-sharp border p-6"
      style={{ borderColor: 'var(--border-muted)', background: 'var(--bg-canvas-deep)' }}
    >
      <div className="h-4 w-12 rounded-sharp mb-4" style={{ background: 'var(--bg-surface)' }} />
      <div className="h-7 w-3/5 rounded-sharp mb-3" style={{ background: 'var(--bg-surface)' }} />
      <div className="h-3 w-full rounded-sharp mb-2" style={{ background: 'var(--bg-surface)' }} />
      <div className="h-3 w-2/3 rounded-sharp" style={{ background: 'var(--bg-surface)' }} />
    </div>
  )
}
