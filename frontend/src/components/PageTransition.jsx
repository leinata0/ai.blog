import { Suspense } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export default function PageTransition({ children, fallback = null }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      id="main-content"
      tabIndex={-1}
      data-ui="page-transition"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <Suspense fallback={fallback}>
        {children}
      </Suspense>
    </motion.div>
  )
}
