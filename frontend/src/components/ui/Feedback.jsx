export function LiveNotice({ error = '', status = '', className = '' }) {
  if (!error && !status) return null
  return (
    <div
      className={`ui-live-notice ${error ? 'ui-live-notice--error' : 'ui-live-notice--success'} ${className}`.trim()}
      role={error ? 'alert' : 'status'}
      aria-live={error ? 'assertive' : 'polite'}
    >
      <span className="ui-live-notice__dot" aria-hidden="true" />
      <span>{error || status}</span>
    </div>
  )
}

export function Field({ label, hint = '', htmlFor, children, className = '' }) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      <label className="ui-field__label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="ui-field__hint">{hint}</span> : null}
    </div>
  )
}
