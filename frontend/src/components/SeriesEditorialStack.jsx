import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Layers3 } from 'lucide-react'

import { proxyImageUrl } from '../utils/proxyImage'
import { getSeriesDescription, getSeriesTitle } from '../utils/contentPresentation'

function buildDesktopCardStyle(index, activeIndex, compact) {
  const delta = index - activeIndex
  const distance = Math.abs(delta)
  const baseShift = compact ? 68 : 82
  const peekShift = compact ? 42 : 56

  return {
    x: delta <= 0 ? Math.max(delta * 16, -44) : baseShift + (distance - 1) * peekShift,
    y: distance * (compact ? 14 : 18),
    scale: delta === 0 ? 1 : Math.max(0.84, 1 - distance * 0.05),
    rotate: delta === 0 ? 0 : delta > 0 ? Math.min(distance * 1.6, 5) : -Math.min(distance * 0.8, 2.4),
    opacity: delta === 0 ? 1 : Math.max(0.44, 1 - distance * 0.14),
    zIndex: 40 - distance,
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
    <div className="flex h-full w-full items-end bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.3),transparent_48%),linear-gradient(135deg,rgba(37,99,235,0.18),rgba(13,148,136,0.14))] p-6">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: '#2563eb' }}>
          Editorial Series
        </div>
        <div className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {getSeriesTitle(series)}
        </div>
      </div>
    </div>
  )
}

function DesktopStack({ items, activeIndex, onActivate, compact = false }) {
  const height = compact ? 390 : 470

  return (
    <div className="hidden md:block">
      <div
        className="relative overflow-hidden rounded-[2rem] border border-[rgba(148,163,184,0.18)] bg-[var(--bg-surface)] p-4"
        style={{ minHeight: height, boxShadow: '0 26px 70px rgba(15, 23, 42, 0.08)' }}
      >
        <div className="relative h-full" style={{ minHeight: height - 32 }}>
          {items.map((series, index) => {
            const isActive = index === activeIndex
            const motionStyle = buildDesktopCardStyle(index, activeIndex, compact)

            return (
              <motion.article
                key={series.slug}
                layout
                initial={false}
                animate={motionStyle}
                transition={{ type: 'spring', stiffness: 220, damping: 26 }}
                className="absolute inset-y-0 left-0 w-[78%] cursor-pointer overflow-hidden rounded-[1.75rem] border"
                style={{
                  zIndex: motionStyle.zIndex,
                  borderColor: isActive ? 'rgba(37, 99, 235, 0.26)' : 'rgba(148, 163, 184, 0.18)',
                  boxShadow: isActive
                    ? '0 28px 80px rgba(15, 23, 42, 0.16)'
                    : '0 14px 32px rgba(15, 23, 42, 0.08)',
                  transformOrigin: 'left center',
                }}
                onMouseEnter={() => onActivate(index)}
                onFocus={() => onActivate(index)}
                onClick={() => onActivate(index)}
              >
                <Link to={`/series/${series.slug}`} className="block h-full">
                  <div className="relative h-full">
                    <SeriesCover series={series} />
                    <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.02),rgba(15,23,42,0.72))]" />
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between px-6 py-5">
                      <span
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                        style={{ backgroundColor: 'rgba(255,255,255,0.82)', color: '#2563eb' }}
                      >
                        <Layers3 size={12} />
                        系列
                      </span>
                      <span
                        className="rounded-full px-3 py-1 text-xs font-medium"
                        style={{ backgroundColor: 'rgba(15,23,42,0.28)', color: 'rgba(255,255,255,0.88)' }}
                      >
                        {series.post_count || series.posts?.length || 0} 篇内容
                      </span>
                    </div>

                    <div className="absolute inset-x-0 bottom-0 p-6 text-white">
                      <div className="max-w-xl">
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
                </Link>
              </motion.article>
            )
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {items.map((series, index) => (
          <button
            key={series.slug}
            type="button"
            onClick={() => onActivate(index)}
            className="rounded-full px-4 py-2 text-sm transition-all"
            style={{
              backgroundColor: index === activeIndex ? 'rgba(37, 99, 235, 0.12)' : 'var(--bg-surface)',
              color: index === activeIndex ? '#2563eb' : 'var(--text-secondary)',
              border: `1px solid ${index === activeIndex ? 'rgba(37, 99, 235, 0.18)' : 'var(--border-muted)'}`,
            }}
          >
            {getSeriesTitle(series)}
          </button>
        ))}
      </div>
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
}) {
  const visibleItems = useMemo(
    () => (mode === 'compact' ? items.slice(0, 4) : items),
    [items, mode],
  )
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (activeIndex > visibleItems.length - 1) {
      setActiveIndex(0)
    }
  }, [activeIndex, visibleItems.length])

  if (!visibleItems.length) {
    return (
      <div
        className="rounded-[1.75rem] border px-6 py-10"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', color: 'var(--text-faint)' }}
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div>
      <DesktopStack items={visibleItems} activeIndex={activeIndex} onActivate={setActiveIndex} compact={mode === 'compact'} />
      <MobileStack items={visibleItems} activeIndex={activeIndex} onActivate={setActiveIndex} />
    </div>
  )
}
