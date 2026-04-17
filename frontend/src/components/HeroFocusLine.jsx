import { useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

const TYPE_SPEED_MS = 58
const DELETE_SPEED_MS = 34
const HOLD_DURATION_MS = 1400
const REDUCED_MOTION_ROTATE_MS = 2800

function useTypedPhrase(phrases) {
  const prefersReducedMotion = useReducedMotion()
  const isMountedRef = useRef(false)
  const safePhrases = useMemo(
    () => phrases.map((phrase) => String(phrase || '').trim()).filter(Boolean),
    [phrases],
  )
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [visibleCount, setVisibleCount] = useState(
    prefersReducedMotion ? (safePhrases[0]?.length || 0) : 0,
  )
  const [phase, setPhase] = useState(prefersReducedMotion ? 'steady' : 'typing')

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    setPhraseIndex(0)
    setVisibleCount(prefersReducedMotion ? (safePhrases[0]?.length || 0) : 0)
    setPhase(prefersReducedMotion ? 'steady' : 'typing')
  }, [prefersReducedMotion, safePhrases])

  useEffect(() => {
    if (!safePhrases.length) return undefined

    if (prefersReducedMotion) {
      const intervalId = globalThis.setInterval(() => {
        if (!isMountedRef.current) return
        setPhraseIndex((current) => (current + 1) % safePhrases.length)
      }, REDUCED_MOTION_ROTATE_MS)

      return () => globalThis.clearInterval(intervalId)
    }

    const currentPhrase = safePhrases[phraseIndex] || ''
    let timerId = 0

    if (phase === 'typing') {
      if (visibleCount < currentPhrase.length) {
        timerId = globalThis.setTimeout(() => {
          if (!isMountedRef.current) return
          setVisibleCount((current) => current + 1)
        }, TYPE_SPEED_MS)
      } else {
        timerId = globalThis.setTimeout(() => {
          if (!isMountedRef.current) return
          setPhase('holding')
        }, HOLD_DURATION_MS)
      }
    } else if (phase === 'holding') {
      timerId = globalThis.setTimeout(() => {
        if (!isMountedRef.current) return
        setPhase('deleting')
      }, HOLD_DURATION_MS)
    } else if (visibleCount > 0) {
      timerId = globalThis.setTimeout(() => {
        if (!isMountedRef.current) return
        setVisibleCount((current) => Math.max(0, current - 1))
      }, DELETE_SPEED_MS)
    } else {
      setPhraseIndex((current) => (current + 1) % safePhrases.length)
      setPhase('typing')
    }

    return () => globalThis.clearTimeout(timerId)
  }, [phase, phraseIndex, prefersReducedMotion, safePhrases, visibleCount])

  const currentPhrase = safePhrases[phraseIndex] || ''

  return {
    prefersReducedMotion,
    text: prefersReducedMotion ? currentPhrase : currentPhrase.slice(0, visibleCount),
  }
}

export default function HeroFocusLine({ phrases = [] }) {
  const { prefersReducedMotion, text } = useTypedPhrase(phrases)

  return (
    <div className="hero-focus-line" data-ui="home-hero-focus" aria-live="polite">
      <span className="hero-focus-line__label">焦点追踪</span>
      <span className="hero-focus-line__text">{text || '\u00a0'}</span>
      {!prefersReducedMotion ? <span className="hero-focus-line__cursor" aria-hidden="true" /> : null}
    </div>
  )
}
