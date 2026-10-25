import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Rss } from 'lucide-react'
import { formatDate, parseDate } from '../../utils/date'
import useResponsiveCover from '../../hooks/useResponsiveCover'
import { buildPublicApiUrl } from '../../utils/publicApiUrl'
import '../../styles/newsroom-collections.css'

const EMPTY_ITEMS = []
const EMPTY_MODULES = {}

function usableItems(items, key, limit) {
  const seen = new Set()
  return (Array.isArray(items) ? items : EMPTY_ITEMS).filter((item) => {
    const value = String(item?.[key] || '').trim()
    if (!value || seen.has(value) || !(Number(item.post_count) > 0)) return false
    if (!String(item.display_title || item.title || '').trim()) return false
    seen.add(value)
    return true
  }).slice(0, limit)
}

function CollectionMeta({ item }) {
  const latest = parseDate(item.latest_post_at)
  return <div className="newsroom-collection-meta">
    <span>{Number(item.post_count)} 篇文章</span>
    {latest ? <span>最近发布 <time dateTime={latest.toISOString()}>{formatDate(item.latest_post_at)}</time></span> : null}
  </div>
}

function SeriesFeature({ series }) {
  const { imageProps, unavailable } = useResponsiveCover(series.cover_image, { sizes: '(max-width: 760px) 90vw, 30vw' })
  const hasCover = !unavailable
  return <Link className={`newsroom-series-feature${hasCover ? ' newsroom-series-feature--with-cover' : ''}`} to={`/series/${encodeURIComponent(series.slug)}`}>
    {hasCover ? <div className="newsroom-series-feature__cover"><img width="480" height="360" {...imageProps} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /></div> : null}
    <div className="newsroom-series-feature__body">
      <span className="newsroom-collections__eyebrow">内容系列 / SERIES</span>
      <h3>{series.title}<ArrowUpRight size={19} aria-hidden="true" /></h3>
      {series.description ? <p>{series.description}</p> : null}
      <CollectionMeta item={series} />
    </div>
  </Link>
}

export default function NewsroomCollections({ modules = EMPTY_MODULES, topics = EMPTY_ITEMS, loading = false, error = '', onRetry }) {
  const topicItems = usableItems(topics, 'topic_key', 4)
  const seriesItems = usableItems(modules?.featured_series, 'slug', 2)
  const hasCollections = topicItems.length > 0 || seriesItems.length > 0

  return <>
    <section id="edition-topics" className="newsroom-collections" data-edition-chapter aria-labelledby="newsroom-topics-title" aria-busy={loading}>
      <header className="newsroom-collections__heading">
        <div><span className="newsroom-collections__eyebrow">III / TOPICS & SERIES</span><h2 id="newsroom-topics-title">主题档案<span>沿一条线索，读得更深。</span></h2></div>
        <Link className="newsroom-collections__more" to="/topics">全部主题 <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </header>

      {error ? <div className="newsroom-collections__error" role="alert"><p>{error}</p>{typeof onRetry === 'function' ? <button type="button" onClick={onRetry}>重试加载 <ArrowRight size={14} aria-hidden="true" /></button> : null}</div> : null}
      {loading && !hasCollections ? <div className="newsroom-collections__loading" role="status"><span>正在载入主题与系列…</span><div aria-hidden="true" /><div aria-hidden="true" /></div> : null}
      {topicItems.length > 0 ? <div className="newsroom-topics-grid">{topicItems.map((topic, index) => <Link className="newsroom-topic" key={topic.topic_key} to={`/topics/${encodeURIComponent(topic.topic_key)}`}>
        <span className="newsroom-topic__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div className="newsroom-topic__body"><h3>{topic.display_title || topic.title}<ArrowUpRight size={17} aria-hidden="true" /></h3>{topic.description ? <p>{topic.description}</p> : null}<CollectionMeta item={topic} /></div>
      </Link>)}</div> : !loading && !error ? <p className="newsroom-collections__empty">{seriesItems.length > 0 ? '暂时没有可展示的主题，先沿已有系列继续阅读。' : '暂时没有可展示的主题与系列，可从完整主题档案继续查找。'}</p> : null}
      {seriesItems.length > 0 ? <div className="newsroom-series-grid" aria-label="内容系列">{seriesItems.map((series) => <SeriesFeature key={series.slug} series={series} />)}</div> : null}
      {loading && hasCollections ? <p className="newsroom-collections__refresh" role="status">正在刷新主题与系列…</p> : null}
    </section>

    <section id="edition-reading" className="newsroom-reading" data-edition-chapter aria-labelledby="newsroom-reading-title">
      <div className="newsroom-reading__copy"><span className="newsroom-collections__eyebrow">IV / KEEP READING</span><h2 id="newsroom-reading-title">让阅读继续。</h2><p>订阅后续发布，或者用日报与周报回看重要变化。</p></div>
      <div className="newsroom-reading__links">
        <div className="newsroom-reading__subscribe"><Link to="/feeds">打开订阅中心 <ArrowUpRight size={17} aria-hidden="true" /></Link><a href={buildPublicApiUrl('/feed.xml')}><Rss size={16} aria-hidden="true" /> RSS 订阅</a></div>
        <nav aria-label="继续阅读"><Link to="/daily">AI 日报 <ArrowUpRight size={14} aria-hidden="true" /></Link><Link to="/weekly">AI 周报 <ArrowUpRight size={14} aria-hidden="true" /></Link><Link to="/archive">历史归档 <ArrowUpRight size={14} aria-hidden="true" /></Link></nav>
      </div>
    </section>
  </>
}
