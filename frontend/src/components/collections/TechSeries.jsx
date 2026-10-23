import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Rss } from 'lucide-react'
import TechPageFrame from '../TechPageFrame'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate, parseDate } from '../../utils/date'
import { getSeriesDescription, getSeriesTitle } from '../../utils/contentPresentation'
import '../../styles/tech-collections.css'

function SeriesCover({ series, decorative = false }) {
  const src = proxyImageUrl(series.cover_image)
  const [failedSrc, setFailedSrc] = useState(null)
  return <>
    {src && src !== failedSrc ? <img src={src} alt={decorative ? '' : getSeriesTitle(series)} loading="lazy" width="600" height="800" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} /> : <div className="tech-series-book__fallback"><span>THE AI OBSERVER</span><strong>{getSeriesTitle(series)}</strong><small>A COLLECTION OF PERSPECTIVES</small></div>}
    <div className="tech-series-book__sheen" />
  </>
}

function ShelfVisual({ items }) {
  return <div className="tech-series-shelf-visual" aria-hidden="true"><div className="tech-series-shelf-visual__orbit" />{items.slice(0, 3).map((series, index) => <div key={series.slug} className={`tech-series-shelf-visual__book tech-series-shelf-visual__book--${index + 1}`}><SeriesCover series={series} decorative /><span>{getSeriesTitle(series)}</span></div>)}<span className="tech-series-shelf-visual__label">CURATED / COLLECTED / CONNECTED</span></div>
}

function SeriesVolume({ series, index, onPrefetch }) {
  const title = getSeriesTitle(series)
  const date = parseDate(series.latest_post_at)
  const count = series.post_count !== null && series.post_count !== undefined && Number.isFinite(Number(series.post_count)) && Number(series.post_count) >= 0 ? Number(series.post_count) : null
  const recentPosts = Array.isArray(series.latest_posts) ? series.latest_posts.filter((post) => post?.slug && post?.title).slice(0, 2) : []
  const to = `/series/${encodeURIComponent(series.slug)}`
  return <article className="tech-series-volume" data-series-slug={series.slug} data-tech-reveal>
    <div className="tech-series-volume__display"><span className="tech-series-volume__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div className="tech-series-volume__shelf" />
      <Link to={to} className="tech-series-book" aria-label={`阅读${title}`} onMouseEnter={() => onPrefetch(series.slug)} onFocus={() => onPrefetch(series.slug)}>
        <div className="tech-series-book__pages" /><div className="tech-series-book__spine"><span>{title}</span><small>{String(index + 1).padStart(2, '0')}</small></div>
        <div className="tech-series-book__front"><SeriesCover series={series} /><div className="tech-series-book__imprint"><span>AI OBSERVER / COLLECTION</span><b>{String(index + 1).padStart(2, '0')}</b></div></div>
      </Link>
    </div>
    <div className="tech-series-volume__copy"><span className="tech-series-volume__eyebrow">COLLECTION {String(index + 1).padStart(2, '0')}{series.is_featured ? ' / 推荐系列' : ''}</span><h2><Link to={to} onMouseEnter={() => onPrefetch(series.slug)} onFocus={() => onPrefetch(series.slug)}>{title}<ArrowUpRight aria-hidden="true" /></Link></h2><p>{getSeriesDescription(series)}</p>
      <dl className="tech-series-volume__stats"><div><dt>收录文章</dt><dd>{count ?? '—'}<small>篇</small></dd></div><div><dt>最近发布</dt><dd className="tech-series-volume__date">{date ? <time dateTime={date.toISOString()}>{formatDate(series.latest_post_at)}</time> : '暂无日期'}</dd></div></dl>
      {recentPosts.length ? <div className="tech-series-volume__contents"><span>从最近一篇开始</span>{recentPosts.map((post) => <Link key={post.slug} to={`/posts/${encodeURIComponent(post.slug)}`}>{post.title}<ArrowUpRight size={14} aria-hidden="true" /></Link>)}</div> : null}
      <div className="tech-series-volume__actions"><Link to={to} onMouseEnter={() => onPrefetch(series.slug)} onFocus={() => onPrefetch(series.slug)}>打开这本收藏 <ArrowRight size={17} aria-hidden="true" /></Link><Link to={`/feeds?series_slug=${encodeURIComponent(series.slug)}`}><Rss size={14} aria-hidden="true" /> 订阅系列</Link></div>
    </div>
  </article>
}

export default function TechSeries({ items, loading, error, onRetry, onPrefetch }) {
  const seen = new Set()
  const collections = items.filter((item) => {
    if (typeof item?.slug !== 'string' || !item.slug.trim() || seen.has(item.slug)) return false
    seen.add(item.slug)
    return true
  })
  return <TechPageFrame section="series" index="04 / THE COLLECTION" title="内容书架" accentTitle="值得收藏的，不止一篇。" description="把分散的文章装订成一条阅读路径。选一本感兴趣的内容收藏，从最新一页读起。"
    meta={<><span>系列总览</span><span>{loading && !collections.length ? '正在整理书架' : error && !collections.length ? '系列数量暂不可用' : `${collections.length} 个内容系列`}</span></>}
    actions={<a href="#series-bookshelf">浏览内容书架 <ArrowUpRight size={16} aria-hidden="true" /></a>}
    visual={<ShelfVisual items={collections} />}>
    <section className="tech-series-library" id="series-bookshelf" aria-labelledby="tech-series-library-title" data-ui="series-page-showcase">
      <div className="tech-collections-section-heading"><div><span>THE READING COLLECTION</span><h2 id="tech-series-library-title">内容书架<span>选一条主线，慢慢读下去。</span></h2></div><Link to="/discover">发现更多文章 <ArrowUpRight size={17} aria-hidden="true" /></Link></div>
      {loading && !collections.length ? <div className="tech-collections-loading tech-series-library__loading" role="status"><span>正在打开内容书架…</span><div /><div /></div> : null}
      {error ? <div className="tech-collections-error" role="alert" data-ui="series-page-error"><p>{error}</p><button type="button" onClick={onRetry}>重新加载系列 <ArrowUpRight size={15} aria-hidden="true" /></button></div> : null}
      {collections.length ? <div className="tech-series-shelf" data-ui="tech-series-shelf">{collections.map((series, index) => <SeriesVolume key={series.slug} series={series} index={index} onPrefetch={onPrefetch} />)}</div> : !loading && !error ? <div className="tech-collections-empty"><h3>下一本收藏，正在酝酿。</h3><p>系列内容正在整理中，稍后这里会出现完整的阅读路径。</p><Link to="/discover">先从一篇文章开始 <ArrowUpRight size={16} aria-hidden="true" /></Link></div> : null}
    </section>
  </TechPageFrame>
}
