import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, ArrowUpRight, Rss } from 'lucide-react'
import SectionCover from '../news/cinematic/SectionCover'
import { formatDate, parseDate } from '../../utils/date'
import { getSeriesDescription, getSeriesTitle } from '../../utils/contentPresentation'
import '../../styles/cinematic-series.css'

function collectionsFrom(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter((item) => {
    const slug = typeof item?.slug === 'string' ? item.slug.trim() : ''
    if (!slug || seen.has(slug)) return false
    seen.add(slug)
    return true
  })
}

function articleCount(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const count = Number(value)
  return Number.isFinite(count) && count >= 0 ? count : null
}

function recentArticles(series) {
  const seen = new Set()
  return (Array.isArray(series.latest_posts) ? series.latest_posts : []).filter((post) => {
    if (typeof post?.slug !== 'string' || !post.slug.trim() || !post.title || seen.has(post.slug)) return false
    seen.add(post.slug)
    return true
  }).slice(0, 3)
}

function SeriesDate({ value }) {
  const date = parseDate(value)
  return date ? <time dateTime={date.toISOString()}>{formatDate(value)}</time> : <>暂无日期</>
}

function SeriesRecord({ series, index, onPrefetch }) {
  const title = getSeriesTitle(series)
  const to = `/series/${encodeURIComponent(series.slug)}`
  const posts = recentArticles(series)
  const count = articleCount(series.post_count)
  const prefetch = () => onPrefetch?.(series.slug)

  return <article className="cinema-series-record" data-series-slug={series.slug}>
    <div className="cinema-series-record__identity">
      <span className="cinema-series-record__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <Link to={to} className="cinema-series-record__cover" onMouseEnter={prefetch} onFocus={prefetch} aria-label={`阅读${title}`}>
        <SectionCover src={series.cover_image} title={title} sizes="(max-width: 760px) 32vw, 18vw" />
      </Link>
    </div>
    <div className="cinema-series-record__copy">
      <span className="cinema-series-record__eyebrow">{series.is_featured ? '编辑推荐 / COLLECTION' : '内容系列 / COLLECTION'}</span>
      <h3><Link to={to} onMouseEnter={prefetch} onFocus={prefetch}>{title}<ArrowUpRight aria-hidden="true" /></Link></h3>
      <p>{getSeriesDescription(series)}</p>
      <div className="cinema-series-record__meta"><span>{count === null ? '收录数量待更新' : `${count} 篇文章`}</span><span>最近发布 <SeriesDate value={series.latest_post_at} /></span></div>
      <Link className="cinema-series-record__subscribe" to={`/feeds?series_slug=${encodeURIComponent(series.slug)}`}><Rss size={14} aria-hidden="true" />订阅系列</Link>
    </div>
    <div className="cinema-series-record__articles">
      <span>最近收录</span>
      {posts.length ? posts.map((post) => <Link key={post.slug} to={`/posts/${encodeURIComponent(post.slug)}`}><span>{post.title}</span><ArrowUpRight size={16} aria-hidden="true" /></Link>) : <p>进入系列，查看已发布内容。</p>}
      <Link className="cinema-series-record__open" to={to} onMouseEnter={prefetch} onFocus={prefetch}>查看完整系列<ArrowRight size={16} aria-hidden="true" /></Link>
    </div>
  </article>
}

export default function TechSeries({ items = [], loading = false, error = '', onRetry, onPrefetch }) {
  const collections = useMemo(() => collectionsFrom(items), [items])
  const [selectedSlug, setSelectedSlug] = useState('')
  const selectedIndex = Math.max(0, collections.findIndex((series) => series.slug === selectedSlug))
  const selected = collections[selectedIndex]
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 0.55
  const selectedCount = selected ? articleCount(selected.post_count) : null
  const select = (series) => {
    setSelectedSlug(series.slug)
    onPrefetch?.(series.slug)
  }

  return <div className="cinema-layout cinema-series">
    <section className="cinema-hero cinema-series-hero" aria-labelledby="cinema-series-title">
      <div className="cinema-series-hero__word" aria-hidden="true">COLLECTIONS</div>
      <div className="cinema-series-hero__intro"><span className="cinema-kicker">04 / THE READING COLLECTION</span><h1 id="cinema-series-title">内容书架</h1><p>把一条主线，<br />读得更深。</p></div>
      {selected ? <>
        <div className="cinema-series-hero__edition">
          <div className="cinema-series-hero__art" aria-hidden="true"><AnimatePresence initial={false}><motion.div className="cinema-series-hero__image" key={selected.slug} initial={{ opacity: 0, y: reduced ? 0 : 20, rotate: reduced ? 0 : 2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0 }} transition={{ duration, ease: [0.22, 1, 0.36, 1] }}><SectionCover src={selected.cover_image} title={getSeriesTitle(selected)} eager sizes="(max-width: 760px) 42vw, 24vw" /><div className="cinema-series-hero__image-shade" /><div className="cinema-series-hero__imprint"><span>AI OBSERVER<br />COLLECTED PERSPECTIVES</span><strong>{String(selectedIndex + 1).padStart(2, '0')}</strong></div></motion.div></AnimatePresence></div>
          <motion.div key={selected.slug} className="cinema-series-hero__selection" initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.35 }}>
            <span className="cinema-series-hero__selection-label">{selected.is_featured ? '编辑推荐' : '正在浏览'} / {String(selectedIndex + 1).padStart(2, '0')}</span>
            <h2>{getSeriesTitle(selected)}</h2><p>{getSeriesDescription(selected)}</p>
            <div className="cinema-series-hero__stats"><span>{selectedCount === null ? '收录数量待更新' : `${selectedCount} 篇文章`}</span><span>最近发布 <SeriesDate value={selected.latest_post_at} /></span></div>
            <Link className="cinema-button" to={`/series/${encodeURIComponent(selected.slug)}`} onMouseEnter={() => onPrefetch?.(selected.slug)} onFocus={() => onPrefetch?.(selected.slug)}>打开这个系列<ArrowUpRight size={18} aria-hidden="true" /></Link>
          </motion.div>
        </div>
        <div className="cinema-series-selector" role="group" aria-label="选择预览系列">{collections.map((series, index) => <button type="button" key={series.slug} aria-pressed={series.slug === selected.slug} onClick={() => select(series)} onMouseEnter={() => onPrefetch?.(series.slug)} onFocus={() => onPrefetch?.(series.slug)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{getSeriesTitle(series)}</strong><ArrowUpRight size={18} aria-hidden="true" /></button>)}</div>
      </> : <div className="cinema-series-hero__waiting"><span className="cinema-kicker">COLLECTED PERSPECTIVES</span>{error ? <div role="alert" data-ui="series-page-error"><p>{error}</p><button type="button" className="cinema-button" onClick={onRetry}>重新加载系列<ArrowRight size={16} aria-hidden="true" /></button></div> : <p role={loading ? 'status' : undefined}>{loading ? '正在打开内容书架…' : '下一条阅读主线，正在酝酿。'}</p>}</div>}
      <a href="#series-bookshelf" className="cinema-series-hero__browse">浏览全部已载入系列<ArrowDown size={17} aria-hidden="true" /></a>
    </section>
    <section className="cinema-body cinema-series-library" id="series-bookshelf" aria-labelledby="cinema-series-library-title" data-ui="series-page-showcase">
      <div className="cinema-section-heading"><div><span className="cinema-kicker">THE CONTINUING STORIES</span><h2 id="cinema-series-library-title">沿着兴趣，继续阅读。</h2></div><p>{loading && !collections.length ? '正在整理系列' : error && !collections.length ? '系列数量暂不可用' : `${collections.length} 个已载入系列`}<br />从最近收录的文章，进入完整主线。</p></div>
      {error && collections.length ? <div className="cinema-state" role="alert" data-ui="series-page-error"><p>{error}</p><button type="button" className="cinema-button" onClick={onRetry}>重新加载系列<ArrowRight size={16} aria-hidden="true" /></button></div> : null}
      {collections.length ? <div className="cinema-series-records" data-ui="tech-series-shelf">{collections.map((series, index) => <SeriesRecord key={series.slug} series={series} index={index} onPrefetch={onPrefetch} />)}</div> : !loading && !error ? <div className="cinema-state"><h3>下一本收藏，正在酝酿。</h3><p>系列内容正在整理中，稍后这里会出现可继续阅读的入口。</p><Link className="cinema-button" to="/discover">先从一篇文章开始<ArrowUpRight size={16} aria-hidden="true" /></Link></div> : null}
      <div className="cinema-series-library__end"><span>保持好奇，持续追踪。</span><Link to="/topics">按主题寻找另一条线索<ArrowUpRight size={17} aria-hidden="true" /></Link></div>
    </section>
  </div>
}
