import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Calendar, FileText, Pin } from 'lucide-react'

import { fetchArchive } from '../api/posts'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'

const CONTENT_TYPE_META = {
  all: {
    label: '全部',
    accent: 'var(--text-secondary)',
    background: 'var(--bg-surface)',
  },
  daily_brief: {
    label: '日报快报',
    accent: 'var(--accent)',
    background: 'var(--accent-soft)',
  },
  weekly_review: {
    label: '每周回顾',
    accent: '#2563eb',
    background: 'rgba(37,99,235,0.12)',
  },
}

function getPostDateKey(post) {
  return post.coverage_date || post.created_at?.slice(0, 10) || 'unknown'
}

function formatDate(dateStr) {
  if (!dateStr || dateStr === 'unknown') return '未标注日期'
  const parsed = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr)
  if (Number.isNaN(parsed.getTime())) return dateStr
  return parsed.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function groupPostsByDay(posts) {
  const groups = new Map()
  posts.forEach((post) => {
    const dateKey = getPostDateKey(post)
    const entry = groups.get(dateKey) ?? { dateKey, posts: [] }
    entry.posts.push(post)
    groups.set(dateKey, entry)
  })
  return Array.from(groups.values()).sort((left, right) => right.dateKey.localeCompare(left.dateKey))
}

export default function ArchivePage() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState('all')
  const [activeSeries, setActiveSeries] = useState('all')
  const [sortMode, setSortMode] = useState('latest')

  useEffect(() => {
    document.title = '归档 - 极客开发日志'
    fetchArchive()
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setLoading(false))
  }, [])

  const allPosts = useMemo(() => groups.flatMap((group) => group.posts), [groups])
  const totalPosts = allPosts.length
  const seriesOptions = useMemo(() => {
    const values = new Map()
    allPosts.forEach((post) => {
      if (post.series_slug) {
        values.set(post.series_slug, post.series?.title || post.series_slug)
      }
    })
    return Array.from(values.entries()).map(([slug, title]) => ({ slug, title }))
  }, [allPosts])
  const counts = useMemo(
    () =>
      allPosts.reduce(
        (acc, post) => {
          if (post.content_type === 'daily_brief') acc.daily_brief += 1
          if (post.content_type === 'weekly_review') acc.weekly_review += 1
          return acc
        },
        { daily_brief: 0, weekly_review: 0 }
      ),
    [allPosts]
  )

  const filteredGroups = useMemo(() => {
    const filteredPosts = allPosts
      .filter((post) => activeType === 'all' || post.content_type === activeType)
      .filter((post) => activeSeries === 'all' || post.series_slug === activeSeries)
      .sort((left, right) => {
        if (sortMode === 'editor_pick') {
          return Number(Boolean(right.is_pinned)) - Number(Boolean(left.is_pinned))
            || String(right.created_at || '').localeCompare(String(left.created_at || ''))
        }
        if (sortMode === 'most_viewed') {
          return (right.view_count || 0) - (left.view_count || 0)
            || String(right.created_at || '').localeCompare(String(left.created_at || ''))
        }
        return String(right.coverage_date || right.created_at || '').localeCompare(String(left.coverage_date || left.created_at || ''))
      })

    const groupedByYear = new Map()
    filteredPosts.forEach((post) => {
      const year = new Date(post.created_at || `${post.coverage_date}T00:00:00`).getFullYear() || new Date().getFullYear()
      const entry = groupedByYear.get(year) ?? { year, posts: [] }
      entry.posts.push(post)
      groupedByYear.set(year, entry)
    })

    return Array.from(groupedByYear.values())
      .sort((left, right) => right.year - left.year)
      .map((group) => ({
        ...group,
        dayGroups: groupPostsByDay(group.posts),
      }))
  }, [activeSeries, activeType, allPosts, sortMode])

  return (
    <main className="min-h-screen" style={{ backgroundColor: 'var(--bg-canvas)' }}>
      <Navbar />

      <div className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <h1 className="mb-2 text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            文章归档
          </h1>
          <p className="mb-8 text-sm" style={{ color: 'var(--text-faint)' }}>
            <FileText size={14} className="mr-1 inline" />
            共 {totalPosts} 篇文章，支持按内容类型、系列与排序方式筛选
          </p>

          <div className="mb-4 flex flex-wrap gap-3" data-ui="archive-type-filter">
            {['all', 'daily_brief', 'weekly_review'].map((type) => {
              const meta = CONTENT_TYPE_META[type]
              const total =
                type === 'all' ? totalPosts : type === 'daily_brief' ? counts.daily_brief : counts.weekly_review
              const active = activeType === type
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setActiveType(type)}
                  data-ui="archive-type-chip"
                  data-content-type={type}
                  className="rounded-full px-4 py-2 text-sm font-medium transition-all duration-200"
                  style={{
                    backgroundColor: active ? meta.background : 'var(--bg-surface)',
                    color: active ? meta.accent : 'var(--text-secondary)',
                    border: `1px solid ${active ? meta.accent : 'var(--border-muted)'}`,
                  }}
                >
                  {meta.label} {total}
                </button>
              )
            })}
          </div>

          <div className="mb-12 grid gap-3 md:grid-cols-2">
            <select
              value={activeSeries}
              onChange={(event) => setActiveSeries(event.target.value)}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="all">全部系列</option>
              {seriesOptions.map((series) => (
                <option key={series.slug} value={series.slug}>{series.title}</option>
              ))}
            </select>

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value)}
              className="rounded-2xl border px-4 py-3 text-sm outline-none"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)', color: 'var(--text-primary)' }}
            >
              <option value="latest">最新</option>
              <option value="most_viewed">最热</option>
              <option value="editor_pick">编辑推荐</option>
            </select>
          </div>
        </motion.div>

        {loading ? (
          <div className="space-y-8">
            {[1, 2].map((index) => (
              <div key={index} className="skeleton-pulse">
                <div className="mb-4 h-8 w-20 rounded" style={{ background: 'var(--bg-surface)' }} />
                <div className="ml-6 space-y-3">
                  <div className="h-5 w-3/4 rounded" style={{ background: 'var(--bg-surface)' }} />
                  <div className="h-5 w-2/3 rounded" style={{ background: 'var(--bg-surface)' }} />
                </div>
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <p style={{ color: 'var(--text-faint)' }}>当前筛选下暂无文章</p>
        ) : (
          <div className="space-y-12">
            {filteredGroups.map((group, groupIndex) => (
              <motion.div
                key={group.year}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIndex * 0.1, duration: 0.4 }}
              >
                <h2 className="mb-6 flex items-center gap-3 text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                  {group.year}
                  <span className="text-sm font-normal" style={{ color: 'var(--text-faint)' }}>
                    ({group.posts.length} 篇)
                  </span>
                </h2>

                <div className="ml-1.5 space-y-8 border-l-2 pl-8" style={{ borderColor: 'var(--border-muted)' }}>
                  {group.dayGroups.map((dayGroup) => (
                    <div
                      key={`${group.year}-${dayGroup.dateKey}`}
                      className="space-y-4"
                      data-ui="archive-day-group"
                      data-date={dayGroup.dateKey}
                      data-group-size={String(dayGroup.posts.length)}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="rounded-full px-3 py-1 text-xs font-semibold"
                          style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                        >
                          {formatDate(dayGroup.dateKey)}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          同日 {dayGroup.posts.length} 篇
                        </span>
                      </div>

                      <div className="space-y-4">
                        {dayGroup.posts.map((post, postIndex) => {
                          const typeMeta = CONTENT_TYPE_META[post.content_type]
                          return (
                            <motion.div
                              key={post.slug}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: groupIndex * 0.08 + postIndex * 0.04 }}
                              className="relative group"
                            >
                              <div
                                className="absolute -left-[2.35rem] top-3 h-2.5 w-2.5 rounded-full border-2 transition-colors duration-200"
                                style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--bg-canvas)' }}
                              />
                              <Link
                                to={`/posts/${post.slug}`}
                                className="flex flex-col gap-2 rounded-2xl px-4 py-3 transition-colors duration-200 group-hover:bg-[var(--bg-surface)]"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <div className="flex flex-wrap items-center gap-3">
                                  <span className="flex flex-shrink-0 items-center gap-1 text-xs" style={{ color: 'var(--text-faint)' }}>
                                    <Calendar size={12} />
                                    {formatDate(post.created_at)}
                                  </span>
                                  {typeMeta ? (
                                    <span
                                      data-ui="archive-type-badge"
                                      data-content-type={post.content_type}
                                      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
                                      style={{ backgroundColor: typeMeta.background, color: typeMeta.accent }}
                                    >
                                      {typeMeta.label}
                                    </span>
                                  ) : null}
                                  {post.series_slug ? (
                                    <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ backgroundColor: 'rgba(15,23,42,0.08)', color: 'var(--text-secondary)' }}>
                                      {post.series?.title || post.series_slug}
                                    </span>
                                  ) : null}
                                  {post.is_pinned ? (
                                    <span
                                      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                                      title="置顶"
                                    >
                                      <Pin size={10} /> 置顶
                                    </span>
                                  ) : null}
                                </div>
                                <span className="text-[15px] font-medium transition-colors duration-200 group-hover:text-[var(--accent)]" style={{ color: 'var(--text-primary)' }}>
                                  {post.title}
                                </span>
                              </Link>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <Footer />
      <BackToTop />
    </main>
  )
}
