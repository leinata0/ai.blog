import { useEffect, useRef, useState } from 'react'
import Navbar from '../../Navbar'
import PrimaryNewsNavigation from '../PrimaryNewsNavigation'
import '../../../styles/cinematic-sections.css'

export default function CinematicNavigation() {
  const navigation = useRef(null)
  const [paper, setPaper] = useState(false)
  useEffect(() => {
    const root = navigation.current?.closest('.cinematic-section')
    let frame = 0
    const measure = () => {
      frame = 0
      const hero = root?.querySelector('.cinema-hero')
      setPaper(Boolean(hero && hero.getBoundingClientRect().bottom < 90))
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null
    if (root) observer?.observe(root)
    measure()
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return <div ref={navigation} className={`cinema-navigation${paper ? ' cinema-navigation--paper' : ''}`}><Navbar immersive><PrimaryNewsNavigation className="cinema-primary-nav" /></Navbar></div>
}
