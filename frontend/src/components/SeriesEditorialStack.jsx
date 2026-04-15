import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Layers3 } from 'lucide-react'

import { proxyImageUrl } from '../utils/proxyImage'
import { getSeriesDescription, getSeriesTitle } from '../utils/contentPresentation'

const HOME_LIMIT = 4
const WHEEL_LOCK_MS = 420
const EDGE_NUDGE_MS = 180
const EDGE_NUDGE_DISTANCE = 10
const DRAG_THRESHOLD = 92
const DRAG_VELOCITY_THRESHOLD = 780

function clampIndex(index, size) {
  if (size <= 0) return 0
  return Math.max(0, Math.min(index, size - 1))
}

function getCardWidth(compact) {
  return compact ? '74%' : '76%'
}

function getDesktopOffsets(compact) {
  return compact
    ? {
        future: ['0%', '15%', '27%', '37%', '46%', '53%'],
        previous: ['0%', '-2%', '-4%', '-6%', '-8%'],
      }
    : {
        future: ['0%', '14%', '25%', '35%', '44%', '52%'],
        previous: ['0%', '-2%', '-4%', '-6%', '-8%'],
      }
}

function buildDesktopCardStyle(index, activeIndex, compact, edgeNudge) {
  const delta = index - activeIndex
  const distance = Math.abs(delta)
  const { future, previous } = getDesktopOffsets(compact)
  const isActive = delta === 0
  const left = delta > 0
    ? future[Math.min(delta, future.length - 1)]
    : previous[Math.min(distance, previous.length - 1)]

  return {
    left,
    x: isActive ? edgeNudge * EDGE_NUDGE_DISTANCE : 0,
    scale: isActive
      ? 1
      : delta > 0
        ? Math.max(0.88, 0.98 - distance * 0.045)
        : Math.max(0.92, 0.97 - distance * 0.018),
    opacity: isActive
      ? 1
      : delta > 0
        ? Math.max(0.22, 0.82 - distance * 0.14)
        : Math.max(0.08, 0.18 - distance * 0.04),
    zIndex: isActive ? 50 : delta > 0 ? 40 - distance : 8 - distance,
  }
}

function SeriesCover({ series }) {
  if (series.cover_image) {
    return (
      <img
        src={proxyImageUrl(series.cover_image)}
        alt={getSeriesTitle(series)}
        className="h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-end bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.32),transparent_46%),linear-gradient(140deg,rgba(37,99,235,0.2),rgba(15,23,42,0.08))] p-6">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: '#2563eb' }}>
          Curated Series
        </div>
        <div className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {getSeriesTitle(series)}
        </div>
      </div>
    </div>
  )
}

function SeriesCardContent({ series, compact = false }) {
  return (
    <div className="relative h-full">
      <SeriesCover series={series} />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.02),rgba(15,23,42,0.78))]" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-5 py-5 sm:px-6">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: 'rgba(255,255,255,0.84)', color: '#2563eb' }}
        >
          <Layers3 size={12} />
          系列
        </span>
        <span
          className="rounded-full px-3 py-1 text-xs font-medium"
          style={{ backgroundColor: 'rgba(15,23,42,0.32)', color: 'rgba(255,255,255,0.9)' }}
        >
          {series.post_count || series.posts?.length || 0} 篇内容
        </span>
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
        <div className={compact ? 'max-w-lg' : 'max-w-xl'}>
          <h3 className="text-2xl font-semibold leading-tight sm:text-3xl">
            {getSeriesTitle(series)}
          </h3>
          <p className="mt-3 text-sm leading-7 text-white/80 sm:text-[15px]">
            {getSeriesDescription(series)}
          </p>
        </div>
        <div className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-white/90">
          进入这条阅读路径
          <ArrowRight size={15} />
        </div>
      </div>
    </div>
  )
}

function StackTabs({ items, activeIndex, onActivate }) {
  const columns = Math.min(Math.max(items.length, 1), 4)

  return (
    <div
      data-ui="series-stack-tabs"
      className="mt-4 grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((series, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={series.slug}
            type="button"
            onClick={() => onActivate(index)}
            aria-pressed={isActive}
            className="min-h-[82px] rounded-[1.4rem] border px-4 py-3 text-left transition-all duration-300"
            style={{
              backgroundColor: isActive ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-surface)',
              borderColor: isActive ? 'rgba(37, 99, 235, 0.24)' : 'var(--border-muted)',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: isActive ? '0 14px 36px rgba(37, 99, 235, 0.12)' : 'none',
            }}
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: isActive ? '#2563eb' : 'var(--text-faint)' }}>
              系列
            </div>
            <div className="mt-2 line-clamp-2 text-sm font-semibold leading-6">
              {getSeriesTitle(series)}
            </div>
            <div className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
              {series.post_count || series.posts?.length || 0} 篇内容
            </div>
          </button>
        )
      })}
    </div>
  )
}

function DesktopStack({
  items,
  activeIndex,
  edgeNudge,
  onActivate,
  onStep,
  compact = false,
}) {
  const wheelLockRef = useRef(0)
  const dragIntentRef = useRef(false)
  const stageHeight = compact ? 420 : 500

  const handleWheel = useCallback((event) => {
    if (items.length <= 1) return
    const primaryDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (Math.abs(primaryDelta) < 18) return

    event.preventDefault()

    const now = Date.now()
    if (now - wheelLockRef.current < WHEEL_LOCK_MS) return
    wheelLockRef.current = now

    onStep(primaryDelta > 0 ? 1 : -1)
  }, [items.length, onStep])

  const handleDragStart = useCallback(() => {
    dragIntentRef.current = false
  }, [])

  const handleDrag = useCallback((_, info) => {
    if (Math.abs(info.offset.x) > 8) {
      dragIntentRef.current = true
    }
  }, [])

  const handleDragEnd = useCallback((_, info) => {
    const shouldAdvance = info.offset.x < -DRAG_THRESHOLD || info.velocity.x < -DRAG_VELOCITY_THRESHOLD
    const shouldRewind = info.offset.x > DRAG_THRESHOLD || info.velocity.x > DRAG_VELOCITY_THRESHOLD

    if (shouldAdvance) {
      onStep(1)
    } else if (shouldRewind) {
      onStep(-1)
    }

    window.setTimeout(() => {
      dragIntentRef.current = false
    }, 0)
  }, [onStep])

  const handleActiveClickCapture = useCallback((event) => {
    if (!dragIntentRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <div className="hidden md:block">
      <div
        data-ui="series-stack-stage"
        className="relative overflow-hidden rounded-[2rem] border border-[rgba(148,163,184,0.18)] bg-[var(--bg-surface)] px-4 pb-4 pt-5"
        style={{ minHeight: stageHeight, boxShadow: '0 26px 70px rgba(15, 23, 42, 0.08)' }}
        onWheel={handleWheel}
      >
        <div className="relative" style={{ minHeight: stageHeight - 36 }}>
          {items.map((series, index) => {
            const isActive = index === activeIndex
            const motionStyle = buildDesktopCardStyle(index, activeIndex, compact, edgeNudge)
            const cardWidth = getCardWidth(compact)

            if (isActive) {
              return (
                <motion.article
                  key={series.slug}
                  initial={false}
                  animate={motionStyle}
                  transition={{ type: 'spring', stiffness: 145, damping: 28, mass: 1.05 }}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.1}
                  dragMomentum={false}
                  onDragStart={handleDragStart}
                  onDrag={handleDrag}
                  onDragEnd={handleDragEnd}
                  className="absolute bottom-0 top-0 overflow-hidden rounded-[1.8rem] border cursor-grab active:cursor-grabbing"
                  style={{
                    width: cardWidth,
                    zIndex: motionStyle.zIndex,
                    borderColor: 'rgba(37, 99, 235, 0.26)',
                    boxShadow: '0 28px 80px rgba(15, 23, 42, 0.16)',
                    touchAction: 'pan-y',
                  }}
                >
                  <Link
                    to={`/series/${series.slug}`}
                    className="block h-full"
                    onClickCapture={handleActiveClickCapture}
                  >
                    <SeriesCardContent series={series} compact={compact} />
                  </Link>
                </motion.article>
              )
            }

            const isVisiblePeek = index > activeIndex

            return (
              <motion.button
                key={series.slug}
                type="button"
                initial={false}
                animate={motionStyle}
                transition={{ type: 'spring', stiffness: 145, damping: 28, mass: 1.05 }}
                onClick={() => onActivate(index)}
                onFocus={() => onActivate(index)}
                className="absolute bottom-0 top-0 overflow-hidden rounded-[1.8rem] border text-left"
                style={{
                  width: cardWidth,
                  zIndex: motionStyle.zIndex,
                  borderColor: isVisiblePeek ? 'rgba(148, 163, 184, 0.24)' : 'rgba(148, 163, 184, 0.12)',
                  boxShadow: isVisiblePeek
                    ? '0 16px 40px rgba(15, 23, 42, 0.08)'
                    : '0 10px 24px rgba(15, 23, 42, 0.04)',
                  pointerEvents: isVisiblePeek ? 'auto' : 'none',
                }}
                aria-label={`切换到系列：${getSeriesTitle(series)}`}
              >
                <SeriesCardContent series={series} compact={compact} />
              </motion.button>
            )
          })}
        </div>
      </div>

      <StackTabs items={items} activeIndex={activeIndex} onActivate={onActivate} />
    </div>
  )
}

function MobileStack({ items, activeIndex, onActivate }) {
  return (
    <div className="space-y-3 md:hidden">
      {items.map((series, index) => {
        const expanded = index === activeIndex
        return (
          <motion.article
            key={series.slug}
            layout
            className="overflow-hidden rounded-[1.5rem] border"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: expanded ? 'rgba(37, 99, 235, 0.24)' : 'var(--border-muted)',
              boxShadow: expanded ? '0 18px 40px rgba(15, 23, 42, 0.08)' : 'none',
            }}
          >
            <button
              type="button"
              onClick={() => onActivate(index)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <div>
                <div className="text-xs font-semibold" style={{ color: '#2563eb' }}>
                  系列
                </div>
                <div className="mt-1 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {getSeriesTitle(series)}
                </div>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                {series.post_count || series.posts?.length || 0} 篇
              </div>
            </button>

            {expanded ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="border-t border-[var(--border-muted)] px-5 py-5"
              >
                <div className="overflow-hidden rounded-2xl">
                  <div className="h-44">
                    <SeriesCover series={series} />
                  </div>
                </div>
                <p className="mt-4 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
                  {getSeriesDescription(series)}
                </p>
                <Link
                  to={`/series/${series.slug}`}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-medium"
                  style={{ color: '#2563eb' }}
                >
                  查看系列详情
                  <ArrowRight size={14} />
                </Link>
              </motion.div>
            ) : null}
          </motion.article>
        )
      })}
    </div>
  )
}

export default function SeriesEditorialStack({
  items = [],
  mode = 'full',
  emptyText = '系列内容正在整理中。',
  dataUi,
}) {
  const visibleItems = useMemo(
    () => (mode === 'compact' ? items.slice(0, HOME_LIMIT) : items),
    [items, mode],
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [edgeNudge, setEdgeNudge] = useState(0)
  const edgeTimerRef = useRef(null)

  useEffect(() => {
    setActiveIndex((current) => clampIndex(current, visibleItems.length))
  }, [visibleItems.length])

  useEffect(() => () => {
    if (edgeTimerRef.current) {
      window.clearTimeout(edgeTimerRef.current)
    }
  }, [])

  const activate = useCallback((index) => {
    setActiveIndex(clampIndex(index, visibleItems.length))
  }, [visibleItems.length])

  const triggerEdgeNudge = useCallback((direction) => {
    if (edgeTimerRef.current) {
      window.clearTimeout(edgeTimerRef.current)
    }
    setEdgeNudge(direction)
    edgeTimerRef.current = window.setTimeout(() => {
      setEdgeNudge(0)
    }, EDGE_NUDGE_MS)
  }, [])

  const step = useCallback((direction) => {
    const next = clampIndex(activeIndex + direction, visibleItems.length)
    if (next === activeIndex) {
      triggerEdgeNudge(direction > 0 ? 1 : -1)
      return
    }
    setEdgeNudge(0)
    setActiveIndex(next)
  }, [activeIndex, triggerEdgeNudge, visibleItems.length])

  if (!visibleItems.length) {
    return (
      <div
        data-ui={dataUi}
        className="rounded-[1.75rem] border px-6 py-10"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', color: 'var(--text-faint)' }}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div data-ui={dataUi}>
      <DesktopStack
        items={visibleItems}
        activeIndex={activeIndex}
        edgeNudge={edgeNudge}
        onActivate={activate}
        onStep={step}
        compact={mode === 'compact'}
      />
      <MobileStack items={visibleItems} activeIndex={activeIndex} onActivate={activate} />
    </div>
  )
}
