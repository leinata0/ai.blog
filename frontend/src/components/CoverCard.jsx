import { Link } from 'react-router-dom'

import { proxyImageUrl } from '../utils/proxyImage'

function CardMedia({ image, imageAlt, overlay, loading = 'lazy', fetchPriority }) {
  if (image) {
    const imageProps = fetchPriority ? { fetchPriority } : {}
    return (
      <div className={`cover-card__media ${overlay ? 'cover-card__media--overlay' : ''}`.trim()}>
        <img
          src={proxyImageUrl(image)}
          alt={imageAlt}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          loading={loading}
          referrerPolicy="no-referrer"
          {...imageProps}
        />
      </div>
    )
  }

  return (
    <div className={`cover-card__media cover-card__media--placeholder ${overlay ? 'cover-card__media--overlay' : ''}`.trim()} />
  )
}

export default function CoverCard({
  to,
  title,
  description,
  image,
  imageAlt,
  eyebrow,
  badge,
  meta = [],
  overlay = false,
  className = '',
  bodyClassName = '',
  children,
  footer,
  imageLoading = 'lazy',
  imageFetchPriority,
}) {
  const Wrapper = to ? Link : 'article'
  const wrapperProps = to ? { to } : {}

  return (
    <Wrapper className={`cover-card group ${overlay ? 'cover-card--overlay' : ''} ${className}`.trim()} {...wrapperProps}>
      <CardMedia image={image} imageAlt={imageAlt || title} overlay={overlay} loading={imageLoading} fetchPriority={imageFetchPriority} />

      <div className={`cover-card__body ${overlay ? 'cover-card__body--overlay' : ''} ${bodyClassName}`.trim()}>
        {(eyebrow || badge) ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {eyebrow ? <span className="cover-card__eyebrow">{eyebrow}</span> : <span />}
            {badge ? <div>{badge}</div> : null}
          </div>
        ) : null}

        <h3 className="cover-card__title">{title}</h3>
        {description ? <p className="cover-card__description">{description}</p> : null}

        {meta.length > 0 ? (
          <div className="cover-card__meta">
            {meta.map((item, index) => (
              <span key={`${title}-${index}`}>{item}</span>
            ))}
          </div>
        ) : null}

        {children}
        {footer ? <div className="cover-card__footer">{footer}</div> : null}
      </div>
    </Wrapper>
  )
}
