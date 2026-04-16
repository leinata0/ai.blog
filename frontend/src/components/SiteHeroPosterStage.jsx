import { motion, useReducedMotion } from 'framer-motion'

import { proxyImageUrl } from '../utils/proxyImage'

const POSTER_LAYERS = [
  {
    key: 'far',
    className: 'hero-poster-stage__poster hero-poster-stage__poster--far',
    animate: {
      y: [0, -6, 0],
      scale: [0.88, 0.894, 0.88],
    },
    transition: {
      duration: 7.6,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  {
    key: 'mid',
    className: 'hero-poster-stage__poster hero-poster-stage__poster--mid',
    animate: {
      y: [0, -8, 0],
      scale: [0.93, 0.946, 0.93],
    },
    transition: {
      duration: 7.1,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: 0.22,
    },
  },
  {
    key: 'front',
    className: 'hero-poster-stage__poster hero-poster-stage__poster--front',
    animate: {
      y: [0, -10, 0],
      scale: [1, 1.018, 1],
    },
    transition: {
      duration: 6.5,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: 0.35,
    },
  },
]

function PosterSurface({ imageSrc, imageAlt, priority = false }) {
  return (
    <div className="hero-poster-stage__surface">
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={imageAlt}
          className="hero-poster-stage__image"
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="hero-poster-stage__placeholder" aria-hidden="true">
          <div className="hero-poster-stage__placeholder-orb hero-poster-stage__placeholder-orb--primary" />
          <div className="hero-poster-stage__placeholder-orb hero-poster-stage__placeholder-orb--secondary" />
          <div className="hero-poster-stage__placeholder-line hero-poster-stage__placeholder-line--short" />
          <div className="hero-poster-stage__placeholder-line hero-poster-stage__placeholder-line--medium" />
          <div className="hero-poster-stage__placeholder-line hero-poster-stage__placeholder-line--long" />
          <div className="hero-poster-stage__placeholder-column hero-poster-stage__placeholder-column--one" />
          <div className="hero-poster-stage__placeholder-column hero-poster-stage__placeholder-column--two" />
          <div className="hero-poster-stage__placeholder-column hero-poster-stage__placeholder-column--three" />
        </div>
      )}
      <div className="hero-poster-stage__sheen" />
      <div className="hero-poster-stage__mesh" />
    </div>
  )
}

export default function SiteHeroPosterStage({
  image,
  imageAlt = '站点主海报',
  signalLabels = [],
}) {
  const prefersReducedMotion = useReducedMotion()
  const imageSrc = image ? proxyImageUrl(image) : ''

  return (
    <div className="hero-poster-stage" data-ui="home-hero-stage">
      <div className="hero-poster-stage__mobile lg:hidden">
        <div className="hero-poster-stage__mobile-card">
          <PosterSurface imageSrc={imageSrc} imageAlt={imageAlt} priority />
        </div>
        {signalLabels.length > 0 ? (
          <div className="hero-poster-stage__signals" aria-hidden="true">
            {signalLabels.map((label) => (
              <span key={label} className="hero-poster-stage__signal-chip">
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="hidden lg:block">
        <div className="hero-poster-stage__canvas">
          <div className="hero-poster-stage__beam hero-poster-stage__beam--left" />
          <div className="hero-poster-stage__beam hero-poster-stage__beam--right" />

          {POSTER_LAYERS.map((layer, index) => (
            <motion.div
              key={layer.key}
              className={layer.className}
              animate={prefersReducedMotion ? undefined : layer.animate}
              transition={prefersReducedMotion ? undefined : layer.transition}
            >
              <PosterSurface imageSrc={imageSrc} imageAlt={imageAlt} priority={index === POSTER_LAYERS.length - 1} />
            </motion.div>
          ))}

          <div className="hero-poster-stage__metrics" aria-hidden="true">
            <span className="hero-poster-stage__metric hero-poster-stage__metric--strong" />
            <span className="hero-poster-stage__metric" />
            <span className="hero-poster-stage__metric" />
          </div>
        </div>

        {signalLabels.length > 0 ? (
          <div className="hero-poster-stage__signals" aria-hidden="true">
            {signalLabels.map((label) => (
              <span key={label} className="hero-poster-stage__signal-chip">
                {label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
