export default function AmbientHeroBackdrop({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()} aria-hidden="true">
      <div className="ambient-grid" />
      <div className="ambient-signal ambient-signal--one" />
      <div className="ambient-signal ambient-signal--two" />
      <div className="ambient-coordinate">35.6762° N / 139.6503° E / SIGNAL INDEX 02</div>
    </div>
  )
}
