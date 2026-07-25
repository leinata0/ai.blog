import { motion, useReducedMotion } from 'framer-motion'

export default function PageTransition({ children }) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      id="main-content"
      tabIndex={-1}
      data-ui="page-transition"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -5 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
