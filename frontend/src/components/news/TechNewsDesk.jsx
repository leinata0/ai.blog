import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, ScanLine } from 'lucide-react'
import { NewsCover, NewsMeta, NewsTitle, PinnedLabel } from './NewsArticle'
import { formatDate, parseDate } from '../../utils/date'
import usePointerSurface from '../../hooks/usePointerSurface'
import '../../styles/news-tech-desk.css'

// A static geometric fallback for missing or failed covers, never a data visualization.
function CoverFallback() {
  return <div className="tech-feature__fallback" aria-hidden="true">
    <div className="tech-feature__glass tech-feature__glass--one" /><div className="tech-feature__glass tech-feature__glass--two" />
    <div className="tech-feature__sphere" /><span>AI / IN FOCUS</span>
  </div>
}

export default function TechNewsDesk({ posts, onPrefetch, onPreview }) {
  const [selectedSlug, setSelectedSlug] = useState(null)
  const pointerProps = usePointerSurface()
  if (!posts.length) return null
  const choices = posts.slice(0, 3)
  const activeIndex = Math.max(0, choices.findIndex((post) => post.slug === selectedSlug))
  const post = choices[activeIndex]
  const indexPosts = posts.slice(3, 7)

  return (
    <section className="tech-desk" aria-label="本期头条" data-ui="news-frontpage">
      <div className="tech-desk__label"><span><ScanLine size={15} aria-hidden="true" /> 本期焦点 <b>IN FOCUS</b></span><a href="#news-feed-title">浏览新闻流 <ArrowRight size={15} aria-hidden="true" /></a></div>
      <article className="tech-feature" {...pointerProps}>
        <div className="tech-feature__copy" key={post.slug}>
          <div className="tech-feature__top"><span>本期头条</span><b>{String(activeIndex + 1).padStart(2, '0')} <i>/ {String(choices.length).padStart(2, '0')}</i></b><PinnedLabel post={post} /></div>
          <NewsMeta post={post} />
          <NewsTitle post={post} as="h2" onPrefetch={onPrefetch} />
          {post.summary ? <p className="tech-feature__summary">{post.summary}</p> : null}
          <div className="tech-feature__actions"><Link to={`/posts/${post.slug}`} onMouseEnter={() => onPrefetch?.(post.slug)}>阅读全文 <ArrowUpRight size={19} aria-hidden="true" /></Link><button type="button" onClick={() => onPreview(post)}>快速预览 <ArrowRight size={15} aria-hidden="true" /></button></div>
        </div>
        <div className="tech-feature__visual">
          <CoverFallback />
          <NewsCover key={post.slug} post={post} priority onPrefetch={onPrefetch} />
          <div className="tech-feature__image-label" aria-hidden="true"><span>THE AI OBSERVER</span><b>FEATURE / {String(activeIndex + 1).padStart(2, '0')}</b></div>
        </div>
      </article>
      <div className="tech-focus-picker" role="group" aria-label="选择焦点报道">
        {choices.map((choice, i) => {
          const date = parseDate(choice.created_at)
          return <button key={choice.slug} type="button" aria-pressed={choice.slug === post.slug} onClick={() => setSelectedSlug(choice.slug)} onMouseEnter={() => onPrefetch?.(choice.slug)} onFocus={() => onPrefetch?.(choice.slug)}>
            <span className="tech-focus-picker__number">{String(i + 1).padStart(2, '0')}</span>
            <span className="tech-focus-picker__body"><small>{date ? <time dateTime={date.toISOString()}>{formatDate(choice.created_at)}</time> : '日期待补充'} <ArrowUpRight size={13} aria-hidden="true" /></small><b>{choice.title}</b></span>
          </button>
        })}
      </div>
      <p className="sr-only" role="status">{selectedSlug ? `当前焦点：${post.title}` : ''}</p>
      <aside className="tech-news-index" aria-label="新闻速览">
        <header><h2>新闻速览</h2><span>MORE TO KNOW</span><Link to="/archive">全部归档 <ArrowUpRight size={14} aria-hidden="true" /></Link></header>
        {indexPosts.length ? <ol>{indexPosts.map((item, i) => <li key={item.slug}><span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span><div><NewsTitle post={item} onPrefetch={onPrefetch} /><NewsMeta post={item} showSources={false} /></div></li>)}</ol> : <p>更多资讯，可以从<Link to="/topics">主题</Link>和<Link to="/archive">历史归档</Link>开始寻找。</p>}
      </aside>
    </section>
  )
}
