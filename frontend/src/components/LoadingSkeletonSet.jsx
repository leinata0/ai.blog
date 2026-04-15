export default function LoadingSkeletonSet({
  count = 3,
  className = '',
  itemClassName = '',
  minHeight = '12rem',
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`loading-skeleton-${index}`}
          className={`loading-skeleton ${itemClassName}`.trim()}
          style={{ minHeight }}
        />
      ))}
    </div>
  )
}
