import { motion, useReducedMotion } from 'framer-motion'

import { proxyImageUrl } from '../utils/proxyImage'

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
          <div className="hero-poster-stage__placeholder-ribbon hero-poster-stage__placeholder-ribbon--top" />
          <div className="hero-poster-stage__placeholder-ribbon hero-poster-stage__placeholder-ribbon--mid" />
          <div className="hero-poster-stage__placeholder-panel hero-poster-stage__placeholder-panel--left" />
          <div className="hero-poster-stage__placeholder-panel hero-poster-stage__placeholder-panel--right" />
          <div className="hero-poster-stage__placeholder-grid" />
        </div>
      )}
      <div className="hero-poster-stage__sheen" />
      <div className="hero-poster-stage__mesh" />
    </div>
  )
}

export default function SiteHeroPosterStage({
  image,
  imageAlt = 'Site hero poster',
}) {
  const prefersReducedMotion = useReducedMotion()
  const imageSrc = image ? proxyImageUrl(image) : ''

  return (
    <div className="hero-poster-stage" data-ui="home-hero-stage" data-layout="single-poster">
      <div className="hero-poster-stage__glow hero-poster-stage__glow--primary" aria-hidden="true" />
      <div className="hero-poster-stage__glow hero-poster-stage__glow--secondary" aria-hidden="true" />
      <motion.div
        className="hero-poster-stage__frame"
        data-ui="home-hero-poster"
        animate={
          prefersReducedMotion
            ? undefined
            : {
                y: [0, -5, 0],
                scale: [1, 1.01, 1],
              }
        }
        transition={
          prefersReducedMotion
            ? undefined
            : {
                duration: 8.4,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      >
        <PosterSurface imageSrc={imageSrc} imageAlt={imageAlt} priority />
      </motion.div>
    </div>
  )
}
