import { Link } from 'react-router-dom'

function ActionLink({ to, href, label, icon: Icon }) {
  if (!label) return null

  const content = (
    <>
      <span>{label}</span>
      {Icon ? <Icon size={14} /> : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} className="section-action">
        {content}
      </Link>
    )
  }

  return (
    <a href={href} className="section-action">
      {content}
    </a>
  )
}

export default function EditorialSectionHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  actionTo,
  actionHref,
  actionIcon,
  className = '',
  titleClassName = '',
  children,
}) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`.trim()}>
      <div className="min-w-0">
        {eyebrow ? <div className="section-kicker">{eyebrow}</div> : null}
        {title ? <h2 className={`section-title ${titleClassName}`.trim()}>{title}</h2> : null}
        {description ? <p className="section-description">{description}</p> : null}
      </div>

      {children || actionLabel ? (
        <div className="flex shrink-0 items-center gap-3">
          {children}
          <ActionLink to={actionTo} href={actionHref} label={actionLabel} icon={actionIcon} />
        </div>
      ) : null}
    </div>
  )
}
