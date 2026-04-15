export default function AmbientHeroBackdrop({ className = '' }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`.trim()} aria-hidden="true">
      <div className="ambient-orb ambient-orb--primary" />
      <div className="ambient-orb ambient-orb--secondary" />
      <div className="ambient-orb ambient-orb--tertiary" />
      <div className="ambient-grid" />
    </div>
  )
}
