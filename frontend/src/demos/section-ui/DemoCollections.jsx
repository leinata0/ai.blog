import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, ArrowUpRight, Search, X } from 'lucide-react'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'
import { getSeriesDescription, getSeriesTitle } from '../../utils/contentPresentation'
import './demo-collections.css'

const list = (value) => Array.isArray(value) ? value : []
const text = (value) => typeof value === 'string' ? value.trim() : ''
const articlePath = (post) => `/posts/${encodeURIComponent(post.slug)}`
const topicPath = (topic) => `/topics/${encodeURIComponent(topic.topic_key)}`
const seriesPath = (series) => `/series/${encodeURIComponent(series.slug)}`

function seriesDescription(series) {
  const description = text(series?.description)
  return !description || /metadata captured|post-publish artifact|placeholder|auto[- ]generated series|series metadata/i.test(description) ? getSeriesDescription(series) : description
}

function uniqueBy(items, key) {
  const seen = new Set()
  return items.filter((item) => {
    const value = text(item?.[key])
    if (!value || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function collectionPosts(collection) {
  const embedded = [
    ...list(collection?.posts),
    ...list(collection?.latest_posts),
    ...list(collection?.articles),
    ...(collection?.latest_post ? [collection.latest_post] : []),
  ]
  if (collection?.latest_post_slug && collection?.latest_post_title) {
    embedded.push({
      slug: collection.latest_post_slug,
      title: collection.latest_post_title,
      cover_image: collection.latest_post_cover_image,
      created_at: collection.latest_post_at,
    })
  }
  return uniqueBy(embedded, 'slug').filter((post) => text(post.title))
}

function collectionCover(collection) {
  return text(collection?.cover_image) || text(collectionPosts(collection).find((post) => text(post.cover_image))?.cover_image)
}

function countLabel(collection, posts) {
  const value = collection?.post_count
  if (value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0) return `${Number(value)} 篇收录`
  return posts.length ? `${posts.length} 篇已载入` : '查看收录'
}

function DemoImage({ src, title, className = '', identity = '', eager = false }) {
  const image = proxyImageUrl(src)
  const [failedImage, setFailedImage] = useState('')
  return <div className={`su-collection-media ${className}`}>
    {image && failedImage !== image ? <img src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" width="1000" height="650" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} /> : <div className="su-collection-placeholder"><span>{identity || 'AI OBSERVER'}</span><strong>{title}</strong><small>暂无可用封面</small></div>}
  </div>
}

function CollectionHeader({ eyebrow, title, description, aside }) {
  return <header className="su-collection-heading">
    <div><p className="su-collection-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="su-collection-intro">{description}</p></div>
    {aside ? <div className="su-collection-heading-note">{aside}</div> : null}
  </header>
}

function TopicFeature({ topic, index }) {
  const title = text(topic.display_title) || text(topic.title) || topic.topic_key
  const posts = collectionPosts(topic)
  const latest = posts[0]
  return <article className={`su-topic-feature su-topic-feature--${index + 1}`}>
    <Link to={topicPath(topic)} className="su-topic-feature-image" aria-label={`浏览主题：${title}`}>
      <DemoImage src={collectionCover(topic)} title={title} identity="TOPIC / 主题" eager={index === 0} />
      <span className="su-topic-image-tag">{countLabel(topic, posts)} <ArrowUpRight size={15} aria-hidden="true" /></span>
    </Link>
    <div className="su-topic-feature-copy"><span className="su-collection-label">TOPIC / 主题档案</span><h2><Link to={topicPath(topic)}>{title}<ArrowUpRight aria-hidden="true" /></Link></h2>{text(topic.description) ? <p>{topic.description}</p> : null}</div>
    {latest ? <Link to={articlePath(latest)} className="su-topic-related"><span>最近收录</span><strong>{latest.title}</strong><ArrowRight size={16} aria-hidden="true" /></Link> : null}
  </article>
}

function TopicIndexItem({ topic }) {
  const title = text(topic.display_title) || text(topic.title) || topic.topic_key
  const posts = collectionPosts(topic)
  return <article className="su-topic-index-item"><Link to={topicPath(topic)}>
    <DemoImage src={collectionCover(topic)} title={title} identity="TOPIC" className="su-topic-index-image" />
    <div className="su-topic-index-copy"><span className="su-collection-label">TOPIC / 主题</span><h3>{title}</h3>{text(topic.description) ? <p>{topic.description}</p> : null}<span className="su-topic-index-count">{countLabel(topic, posts)}</span></div>
    <ArrowUpRight size={19} className="su-topic-index-arrow" aria-hidden="true" />
  </Link></article>
}

export function TopicsDemo({ data }) {
  const [query, setQuery] = useState('')
  const topics = uniqueBy(list(data?.topics), 'topic_key')
  const keyword = query.trim().toLocaleLowerCase()
  const matches = keyword ? topics.filter((topic) => `${topic.display_title || ''} ${topic.title || ''} ${topic.description || ''} ${topic.topic_key}`.toLocaleLowerCase().includes(keyword)) : topics
  const featured = keyword ? [] : matches.slice(0, 2)
  const indexed = keyword ? matches : matches.slice(2)

  return <div className="su-topics-demo">
    <CollectionHeader eyebrow="03 / TOPICS · 主题" title="你关心的事，继续追踪。" description="把分散的报道放回同一个主题。看新进展，也找到它的来路。" aside={<><span>按主题阅读</span><strong>{topics.length}<small> 个主题</small></strong></>} />
    <div className="su-topic-toolbar"><span className="su-collection-label">主题索引</span><div className="su-topic-search"><Search size={18} aria-hidden="true" /><label className="su-visually-hidden" htmlFor="su-topic-query">搜索已载入主题</label><input id="su-topic-query" type="search" value={query} placeholder="搜索公司、模型或主题" onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" onClick={() => setQuery('')} aria-label="清空主题搜索"><X size={17} aria-hidden="true" /></button> : null}</div><span className="su-topic-result-count" aria-live="polite">{keyword ? `${matches.length} 个结果` : '全部主题'}</span></div>
    {featured.length ? <section className={`su-topics-featured${featured.length === 1 ? ' su-topics-featured--single' : ''}`} aria-label="主题入口">{featured.map((topic, index) => <TopicFeature key={topic.topic_key} topic={topic} index={index} />)}</section> : null}
    {indexed.length ? <section className="su-topic-index" aria-label={keyword ? '主题搜索结果' : '更多主题'}>{indexed.map((topic) => <TopicIndexItem key={topic.topic_key} topic={topic} />)}</section> : null}
    {!matches.length ? <div className="su-collection-empty" role="status"><h2>{keyword ? '没有找到这个主题' : '主题内容正在整理'}</h2><p>{keyword ? '试试更短的名称，或返回全部主题。' : '先从已发布的日报开始阅读。'}</p>{keyword ? <button type="button" onClick={() => setQuery('')}>清空搜索 <ArrowRight size={16} aria-hidden="true" /></button> : <Link to="/demo/sections/daily">阅读日报 <ArrowRight size={16} aria-hidden="true" /></Link>}</div> : null}
  </div>
}

function SeriesSheet({ series, index }) {
  const title = getSeriesTitle(series)
  const description = seriesDescription(series)
  const posts = collectionPosts(series)
  return <article className={`su-series-sheet su-series-sheet--${index % 3 + 1}`}>
    <div className="su-series-sheet-main"><Link className="su-series-sheet-cover" to={seriesPath(series)} aria-label={`查看系列：${title}`}><DemoImage src={collectionCover(series)} title={title} identity="COLLECTION / 系列" eager={index === 0} /><span className="su-series-cover-mark">COLLECTION {String(index + 1).padStart(2, '0')} <ArrowUpRight size={19} aria-hidden="true" /></span></Link>
      <div className="su-series-sheet-copy"><span className="su-collection-label">连续阅读 / {countLabel(series, posts)}</span><h2><Link to={seriesPath(series)}>{title}</Link></h2>{description ? <p>{description}</p> : null}<Link className="su-series-open" to={seriesPath(series)}>进入系列 <ArrowUpRight size={19} aria-hidden="true" /></Link></div>
    </div>
    <div className="su-series-contents"><div className="su-series-contents-label"><span className="su-collection-label">INSIDE THIS COLLECTION</span><h3>从这些篇目开始</h3></div>{posts.length ? <div className="su-series-contents-list">{posts.slice(0, 4).map((post) => <Link key={post.slug} to={articlePath(post)}><span className="su-series-content-dot" aria-hidden="true" /><strong>{post.title}</strong>{formatDate(post.created_at) ? <time dateTime={post.created_at}>{formatDate(post.created_at)}</time> : null}<ArrowUpRight size={16} aria-hidden="true" /></Link>)}</div> : <div className="su-series-contents-empty"><p>完整篇目在系列页中查看。</p><Link to={seriesPath(series)}>打开篇目目录 <ArrowRight size={16} aria-hidden="true" /></Link></div>}</div>
  </article>
}

export function SeriesDemo({ data }) {
  const series = uniqueBy(list(data?.series), 'slug')
  const populated = series.filter((item) => collectionPosts(item).length || item.post_count === null || item.post_count === undefined || Number(item.post_count) > 0)
  const unfilled = series.filter((item) => !populated.includes(item))
  return <div className="su-series-demo"><CollectionHeader eyebrow="04 / COLLECTIONS · 系列" title="一个方向，不止一篇。" description="围绕一个问题展开的内容集合。选一条主线，把背景、变化和实践接着读下去。" aside={<><span>专题策划</span><strong>{series.length}<small> 个系列</small></strong></>} />
    {populated.length ? <div className="su-series-sheets">{populated.map((item, index) => <SeriesSheet key={item.slug} series={item} index={index} />)}</div> : !series.length ? <div className="su-collection-empty"><h2>系列内容正在整理</h2><p>你也可以按主题，继续追踪已经发布的报道。</p><Link to="/demo/sections/topics">浏览主题 <ArrowRight size={16} aria-hidden="true" /></Link></div> : null}
    {unfilled.length ? <section className="su-series-unfilled" aria-labelledby="su-series-unfilled-title"><div className="su-series-unfilled-heading"><h2 id="su-series-unfilled-title">更多系列</h2><span>尚未收录文章</span></div><div className="su-series-unfilled-grid">{unfilled.map((item, index) => <article key={item.slug} className={`su-series-unfilled-card su-series-unfilled-card--${index % 3 + 1}`}><Link to={seriesPath(item)}><span className="su-collection-label">COLLECTION / 0 篇收录</span><h3>{getSeriesTitle(item)}<ArrowUpRight size={19} aria-hidden="true" /></h3><p>{seriesDescription(item)}</p><span className="su-series-unfilled-link">查看系列介绍 <ArrowRight size={15} aria-hidden="true" /></span></Link></article>)}</div></section> : null}
    <div className="su-collection-next"><span>想从一个具体问题开始？</span><Link to="/demo/sections/topics">打开主题索引 <ArrowRight size={18} aria-hidden="true" /></Link></div>
  </div>
}

function ReadingPath({ number, label, title, description, to, action, post, image, secondary, tone }) {
  return <article className={`su-reading-path su-reading-path--${tone}`}><Link to={to} className="su-reading-path-image" aria-label={action}><DemoImage src={image} title={title} identity={label} /><span className="su-reading-path-number" aria-hidden="true">{number}</span><ArrowUpRight size={23} aria-hidden="true" /></Link><div className="su-reading-path-copy"><span className="su-collection-label">{label}</span><h2><Link to={to}>{title}</Link></h2><p>{description}</p><div className="su-reading-path-actions"><Link to={to}>{action} <ArrowRight size={16} aria-hidden="true" /></Link>{secondary ? <Link to={secondary.to}>{secondary.label} <ArrowUpRight size={14} aria-hidden="true" /></Link> : null}</div></div>{post ? <Link className="su-reading-path-latest" to={articlePath(post)}><span>最近发布{formatDate(post.created_at) ? ` / ${formatDate(post.created_at)}` : ''}</span><strong>{post.title}</strong><ArrowUpRight size={15} aria-hidden="true" /></Link> : null}</article>
}

export function ReadingDemo({ data }) {
  const daily = list(data?.daily).find((post) => post?.slug && text(post.title))
  const weekly = list(data?.weekly).find((post) => post?.slug && text(post.title))
  const topic = list(data?.topics).find((item) => item?.topic_key)
  return <div className="su-reading-demo"><CollectionHeader eyebrow="05 / START HERE · 阅读指南" title="找到适合你的读法。" description="看最近发布的消息，读一周的变化，或者沿着一个问题继续。选择你现在需要的入口。" aside={<><span>不必从头读起</span><ArrowDown size={28} aria-hidden="true" /></>} />
    <section className="su-reading-paths" aria-label="三种阅读路径"><ReadingPath number="01" label="KEEP UP / 跟上新变化" title="看看最近有哪些变化" description="按发布日期阅读日报，回看模型、产品与行业的新进展。" to="/demo/sections/daily" action="阅读日报" post={daily} image={daily?.cover_image} tone="daily" /><ReadingPath number="02" label="GO DEEPER / 多一点背景" title="把一周放在一起看" description="进入周报，把一段时间里的变化与线索放回同一个上下文。" to="/demo/sections/weekly" action="阅读周报" post={weekly} image={weekly?.cover_image} tone="weekly" /><ReadingPath number="03" label="FOLLOW A THREAD / 沿着问题读" title="追踪你关心的方向" description="主题聚合相关报道，系列组织连续篇目。找到一个问题，接着往下读。" to="/demo/sections/topics" action="探索主题" image={topic ? collectionCover(topic) : ''} secondary={{ to: '/demo/sections/series', label: '浏览系列' }} tone="topics" /></section>
    <section className="su-reading-notes" aria-labelledby="su-reading-notes-title"><div className="su-reading-notes-heading"><span className="su-collection-label">BEFORE YOU READ</span><h2 id="su-reading-notes-title">读一条消息，先看这三处。</h2></div><dl><div><dt><span>01</span>发布日期</dt><dd>文章何时在本站发布。先确认这是近期更新，还是一条历史记录。</dd></div><div><dt><span>02</span>覆盖日期</dt><dd>日报或周报整理的时间范围。它可能早于文章实际发布的日期。</dd></div><div><dt><span>03</span>原始来源</dt><dd>沿正文引用回到原文，核对产品条件、研究结论与事件细节。</dd></div></dl></section>
    <nav className="su-reading-utilities" aria-label="更多阅读工具"><Link to="/archive"><span>找回一篇旧文章</span><strong>历史归档 <ArrowUpRight size={20} aria-hidden="true" /></strong></Link><Link to="/search"><span>已经有具体名称</span><strong>搜索文章 <ArrowUpRight size={20} aria-hidden="true" /></strong></Link><Link to="/feeds"><span>有新内容时再来</span><strong>订阅更新 <ArrowUpRight size={20} aria-hidden="true" /></strong></Link></nav>
  </div>
}
