import { Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'

// App 用 key={pathname} 挂载 PageTransition，所以"挂载"就等于"路由切换"。
// 首屏不抢焦点，之后每次换页都把焦点交回 #main-content。
let hasCompletedFirstRoute = false

// 播报节点必须常驻 DOM：如果它跟着路由子树一起被重建，
// 读屏软件往往不会播报"插入时就已带文本"的 live region。
let announcerHost = null

function getAnnouncerHost() {
  if (typeof document === 'undefined' || !document.body) return null
  if (announcerHost?.isConnected) return announcerHost
  announcerHost = document.createElement('div')
  announcerHost.setAttribute('data-ui', 'route-announcer-host')
  document.body.appendChild(announcerHost)
  return announcerHost
}

function readDocumentTitle() {
  if (typeof document === 'undefined') return ''
  return document.title || ''
}

export default function PageTransition({ children, fallback = null }) {
  const reduceMotion = useReducedMotion()
  const containerRef = useRef(null)
  const [announcement, setAnnouncement] = useState('')
  const host = getAnnouncerHost()

  useEffect(() => {
    if (!hasCompletedFirstRoute) {
      hasCompletedFirstRoute = true
      return
    }
    // preventScroll 保证不与滚动恢复/动画抢位置。
    containerRef.current?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    let cancelled = false
    function syncAnnouncement() {
      if (cancelled) return
      const title = readDocumentTitle()
      setAnnouncement((current) => (current === title ? current : title))
    }

    syncAnnouncement()

    if (typeof MutationObserver === 'undefined' || !document.head) {
      return () => {
        cancelled = true
      }
    }

    // 页面标题往往在懒加载子路由挂载后才写入，所以持续观察 <title> 的变化。
    const observer = new MutationObserver(syncAnnouncement)
    observer.observe(document.head, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <motion.div
        ref={containerRef}
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
      {host ? createPortal(
        <div
          data-ui="route-announcer"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {announcement}
        </div>,
        host,
      ) : null}
    </>
  )
}
