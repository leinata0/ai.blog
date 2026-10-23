import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Rss } from 'lucide-react'
import TechPageFrame from '../TechPageFrame'
import LoadingSkeletonSet from '../LoadingSkeletonSet'
import EmptyStatePanel from '../EmptyStatePanel'
import { formatDate, parseDate } from '../../utils/date'
import { proxyImageUrl } from '../../utils/proxyImage'
import { buildSubscriptionCenterHref } from '../../utils/subscriptionLinks'
import '../../styles/tech-content-edition.css'

function postHref(post) {
  return `/posts/${encodeURIComponent(post.slug)}`
}

function PostMetadata({ post, withDate = true }) {
  const published = parseDate(post.created_at)
  return <div className="tech-content-metadata">
    {withDate && published ? <time dateTime={post.created_at}>发布 {formatDate(post.created_at)}</time> : null}
    {post.coverage_date ? <span>覆盖 {post.coverage_date}</span> : null}
    {Number(post.source_count) > 0 ? <span>{post.source_count} 个来源</span> : null}
    {Number(post.reading_time) > 0 ? <span>{post.reading_time} 分钟阅读</span> : null}
  </div>
}

function IssueImage({ post, eager = false }) {
  const src = proxyImageUrl(post?.cover_image)
  const [failedSrc, setFailedSrc] = useState(null)
  if (!src || failedSrc === src) return <div className="tech-issue-image tech-issue-image--empty"><span>{src ? '配图暂不可用' : '暂无配图'}</span></div>
  return <div className="tech-issue-image"><img src={src} alt="" width="800" height="1000" loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : undefined} referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} /></div>
}

function DateIndex({ post, count, loading, error }) {
  const date = parseDate(post?.created_at)
  const formatted = date ? formatDate(post.created_at) : ''
  const [year, month, day] = formatted.split('/')
  return <div className="tech-content-date-index" aria-label="日报日期索引">
    <div className="tech-content-date-index__top"><span>SIGNAL LOG / 日报</span><span>{date ? year : '—'}</span></div>
    {date ? <><time dateTime={post.created_at}><span>{month}<i>/</i></span><b>{day}</b></time><div className="tech-content-date-index__note"><span>最近发布</span><span>{formatted}</span></div></> : <p className="tech-content-date-index__waiting">{loading ? '正在载入日期' : error ? '日期暂不可用' : '等待新的发布'}</p>}
    <div className="tech-content-date-index__bottom"><span>DATE / SOURCE / CONTEXT</span><span>{loading ? '载入中' : error ? '档案暂不可用' : `已载入 ${count} 篇`}</span></div>
  </div>
}

function MagazineCover({ post, loading, error }) {
  if (!post) return <div className="tech-issue-cover tech-issue-cover--waiting"><span>THE LONG VIEW</span><p>{loading ? '正在整理周报' : error ? '周报暂不可用' : '等待新的发布'}</p><b>AI 周报</b></div>
  return <Link to={postHref(post)} className="tech-issue-cover" aria-label={`阅读最新周报：${post.title}`}>
    <IssueImage post={post} eager />
    <div className="tech-issue-cover__ink"><span>THE LONG VIEW / AI 周报</span><b>{post.title}</b>{parseDate(post.created_at) ? <time dateTime={post.created_at}>{formatDate(post.created_at)}</time> : null}</div>
    <span className="tech-issue-cover__spine" aria-hidden="true">AI OBSERVER / WEEKLY REVIEW</span>
  </Link>
}

function ChannelNavigation({ weekly }) {
  return <nav className="tech-content-tabs" aria-label="新闻栏目"><Link to="/daily" aria-current={!weekly ? 'page' : undefined}>日报<span>DAILY LOG</span></Link><Link to="/weekly" aria-current={weekly ? 'page' : undefined}>周报<span>THE LONG VIEW</span></Link><Link to="/archive">全部归档<ArrowUpRight size={15} aria-hidden="true" /></Link></nav>
}

function LatestStory({ post, weekly }) {
  return <article className={`tech-content-latest${weekly ? ' tech-content-latest--weekly' : ''}`} data-story-slug={post.slug} data-tech-reveal>
    <div className="tech-content-latest__copy"><span className="tech-content-eyebrow">{weekly ? 'LATEST EDITION / 最新一期' : 'LATEST SIGNAL / 最新报道'}</span><h2><Link to={postHref(post)}>{post.title}</Link></h2>{post.summary ? <p>{post.summary}</p> : null}<PostMetadata post={post} /><Link className="tech-content-read" to={postHref(post)}>阅读全文 <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
    {!weekly && post.cover_image ? <Link className="tech-content-latest__image" to={postHref(post)} aria-label={`阅读配图报道：${post.title}`}><IssueImage post={post} eager /></Link> : null}
  </article>
}

function DailyLog({ posts }) {
  return <section className="tech-content-log" aria-labelledby="tech-content-log-title"><header className="tech-content-archive-heading"><div><span className="tech-content-eyebrow">THE LOG / PUBLICATION INDEX</span><h2 id="tech-content-log-title">往期 AI 日报</h2></div><span>本页往期 {posts.length} 篇</span></header><ol className="tech-content-timeline">{posts.map((post) => <li key={post.slug} className="tech-content-log-entry" data-story-slug={post.slug} data-tech-reveal>
    <div className="tech-content-log-entry__date">{parseDate(post.created_at) ? <time dateTime={post.created_at}>{formatDate(post.created_at)}</time> : <span>日期待补充</span>}<span className="tech-content-log-entry__node" aria-hidden="true" /></div>
    <article><h3><Link to={postHref(post)}>{post.title}<ArrowUpRight size={17} aria-hidden="true" /></Link></h3>{post.summary ? <p>{post.summary}</p> : null}<PostMetadata post={post} withDate={false} /></article>
  </li>)}</ol></section>
}

function WeeklyLibrary({ posts }) {
  return <section className="tech-content-library" aria-labelledby="tech-content-library-title"><header className="tech-content-archive-heading"><div><span className="tech-content-eyebrow">PREVIOUS EDITIONS</span><h2 id="tech-content-library-title">往期 AI 周报</h2></div><span>本页往期 {posts.length} 篇</span></header><div className="tech-issue-grid">{posts.map((post) => <article className="tech-issue" key={post.slug} data-story-slug={post.slug} data-tech-reveal>
    <Link className="tech-issue__visual" to={postHref(post)} aria-label={`阅读周报封面：${post.title}`}><IssueImage post={post} /><span className="tech-issue__cover-label">THE AI OBSERVER <b>WEEKLY</b></span>{parseDate(post.created_at) ? <time dateTime={post.created_at}>{formatDate(post.created_at)}</time> : null}</Link>
    <div className="tech-issue__copy"><PostMetadata post={post} /><h3><Link to={postHref(post)}>{post.title}</Link></h3>{post.summary ? <p>{post.summary}</p> : null}<Link className="tech-content-read" to={postHref(post)}>阅读这一期 <ArrowUpRight size={16} aria-hidden="true" /></Link></div>
  </article>)}</div></section>
}

export default function TechContentEdition({ contentType, copy, posts, loading, error, onRetry, feedUrl }) {
  const weekly = contentType === 'weekly_review'
  const latest = posts[0] || null
  const previous = posts.slice(1)
  return <TechPageFrame section={weekly ? 'weekly' : 'daily'} index={weekly ? '02 / WEEKLY EDITIONS' : '01 / DAILY SIGNALS'} title={copy.title} accentTitle={weekly ? '把变化，读深。' : '信号日志。'} description={weekly ? '从一周的材料出发，把分散的变化读成完整脉络。每一期，都保留它的时间与来源。' : '把重要消息放回时间线上。查看真实发布的报道，再沿来源理解事件的背景。'} meta={<div className="tech-content-status">{parseDate(latest?.created_at) ? <span>最近发布 <time dateTime={latest.created_at}>{formatDate(latest.created_at)}</time></span> : <span>{loading ? '栏目正在载入' : error ? '栏目暂不可用' : '暂无发布日期'}</span>}<span>{loading ? '等待载入' : error ? '数量暂不可用' : `本页 ${posts.length} 篇`}</span></div>} actions={<><a className="tech-content-subscription" href={feedUrl} target="_blank" rel="noreferrer"><Rss size={15} aria-hidden="true" />订阅 {copy.title} RSS</a><Link className="tech-content-subscription" to={buildSubscriptionCenterHref({ contentType })}>订阅这个栏目 <ArrowRight size={15} aria-hidden="true" /></Link></>} visual={weekly ? <MagazineCover post={latest} loading={loading} error={error} /> : <DateIndex post={latest} count={posts.length} loading={loading} error={error} />}>
    <div className={`tech-content-edition tech-content-edition--${weekly ? 'weekly' : 'daily'}`}>
      <ChannelNavigation weekly={weekly} />
      <div className="tech-content-contents" aria-busy={loading}>
        {loading ? <div className="tech-content-loading" role="status"><span>正在载入{copy.title}…</span><LoadingSkeletonSet count={1} minHeight="15rem" /><LoadingSkeletonSet count={3} minHeight="5rem" /></div> : error ? <div className="tech-content-message" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重新加载栏目 <ArrowRight size={16} aria-hidden="true" /></button></div> : !latest ? <EmptyStatePanel title={`${copy.title} 暂时还没有内容`} description="新的栏目文章发布后，会优先展示在这里。" /> : <><LatestStory post={latest} weekly={weekly} />{previous.length > 0 ? weekly ? <WeeklyLibrary posts={previous} /> : <DailyLog posts={previous} /> : null}</>}
      </div>
    </div>
  </TechPageFrame>
}
