export function AdminPanel({ as: Component = 'section', className = '', children, ...props }) {
  return (
    <Component className={`ops-panel ${className}`.trim()} {...props}>
      {children}
    </Component>
  )
}

export function AdminEyebrow({ children, className = '' }) {
  return <p className={`ops-eyebrow ${className}`.trim()}>{children}</p>
}

export function AdminLiveNotice({ error = '', status = '' }) {
  if (!error && !status) return null

  return (
    <div
      className={`ops-notice ${error ? 'ops-notice--error' : 'ops-notice--success'}`}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
    >
      <span className="ops-notice__pulse" aria-hidden="true" />
      <span>{error || status}</span>
    </div>
  )
}

export function AdminField({ label, hint, htmlFor, children }) {
  return (
    <div className="ops-field">
      <label className="ops-field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="ops-field__hint">{hint}</span> : null}
    </div>
  )
}
