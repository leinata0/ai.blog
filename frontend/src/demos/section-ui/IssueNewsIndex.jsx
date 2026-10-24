import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Focus, ImageOff, Search, X } from 'lucide-react'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'
import './issue-news-index.css'

const EMPTY_POSTS = []

function NewsImage({ post, className = '' }) {
  const src = proxyImageUrl(post?.cover_image)
  const [failed, setFailed] = useState('')
  return <span className={`inx-image ${className}`}>
    {src && failed !== src
      ? <img src={src} alt="" width="1200" height="800" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <span className="inx-image-fallback"><ImageOff size={24} strokeWidth={1.25} aria-hidden="true" /><span>{src ? '封面暂不可用' : '文字报道'}</span></span>}
  </span>
}

function NewsDate({ post }) {
  const date = formatDate(post?.created_at)
  return date ? <time dateTime={post.created_at}>{date}</time> : <span>发布日期未提供</span>
}

function SourceCount({ post }) {
  const count = post?.source_count
  return Number.isFinite(count) && count > 0 ? <span>{count} 个来源</span> : null
}

function FocusButton({ post, onFocus, compact = false }) {
  return typeof onFocus === 'function' ? <button type="button" className={`inx-focus-button${compact ? ' inx-focus-compact' : ''}`} onClick={() => onFocus(post.slug)} aria-label={`设为焦点：${post.title}`}>
    <Focus size={15} strokeWidth={1.5} aria-hidden="true" /><span>设为焦点</span>
  </button> : null
}

function FeaturedNews({ posts, onFocus }) {
  const [lead, ...side] = posts.slice(0, 4)
  if (!lead) return null
  return <section className="inx-feature" aria-labelledby="inx-feature-heading">
    <header className="inx-section-rule"><h2 id="inx-feature-heading">继续关注</h2><span>SELECTED STORIES</span></header>
    <div className="inx-feature-grid">
      <article className="inx-lead">
        <Link className="inx-lead-image-link" to={`/posts/${lead.slug}`} aria-label={`阅读：${lead.title}`}>
          <NewsImage post={lead} /><span className="inx-image-arrow"><ArrowUpRight size={23} strokeWidth={1.5} aria-hidden="true" /></span>
        </Link>
        <div className="inx-lead-details">
          <div className="inx-meta"><NewsDate post={lead} /><SourceCount post={lead} /></div>
          <h3><Link to={`/posts/${lead.slug}`}>{lead.title}</Link></h3>
          {lead.summary ? <p className="inx-lead-summary">{lead.summary}</p> : null}
          <FocusButton post={lead} onFocus={onFocus} />
        </div>
      </article>
      <div className="inx-side-stories">
        {side.map((post, index) => <article className="inx-side-story" key={post.slug}>
          <div className="inx-side-copy">
            <span className="inx-story-number" aria-hidden="true">0{index + 2}</span>
            <h3><Link to={`/posts/${post.slug}`}>{post.title}</Link></h3>
            <div className="inx-meta"><NewsDate post={post} /><SourceCount post={post} /></div>
            <FocusButton post={post} onFocus={onFocus} compact />
          </div>
          <Link className="inx-side-image-link" to={`/posts/${post.slug}`} aria-label={`阅读：${post.title}`}><NewsImage post={post} /></Link>
        </article>)}
        <p className="inx-historical-note">内容为历史报道样本，日期沿用原发布日期。</p>
      </div>
    </div>
  </section>
}

export default function IssueNewsIndex({ posts = EMPTY_POSTS, onFocus }) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const entries = Array.isArray(posts) ? posts : EMPTY_POSTS
  const keyword = query.trim().toLocaleLowerCase()
  const visible = keyword ? entries.filter((post) => `${post.title || ''} ${post.summary || ''}`.toLocaleLowerCase().includes(keyword)) : entries

  return <div className="inx-body" id="news-index">
    <div className="inx-content">
      <FeaturedNews posts={entries} onFocus={onFocus} />

      <aside className="inx-path-strip" aria-label="延伸阅读">
        <Link to="/topics"><span className="inx-path-eyebrow">FOLLOW THE SUBJECT</span><span className="inx-path-title">沿着主题，继续追踪。<ArrowUpRight size={25} strokeWidth={1.4} aria-hidden="true" /></span></Link>
        <Link to="/weekly"><span className="inx-path-eyebrow">THE WEEKLY EDIT</span><span className="inx-path-title">把一周的线索连起来。<ArrowUpRight size={25} strokeWidth={1.4} aria-hidden="true" /></span></Link>
      </aside>

      <section className="inx-archive" aria-labelledby="inx-archive-heading">
        <header className="inx-archive-heading">
          <div><p className="inx-eyebrow">THE NEWS INDEX</p><h2 id="inx-archive-heading">新闻档案<span>{String(entries.length).padStart(2, '0')}</span></h2></div>
          <div className="inx-search-wrap">
            <label className="inx-search" htmlFor={searchId}>
              <Search size={18} strokeWidth={1.4} aria-hidden="true" />
              <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、公司或关键词" aria-label="搜索新闻档案" />
              {query ? <button type="button" onClick={() => setQuery('')} aria-label="清空档案搜索"><X size={17} aria-hidden="true" /></button> : null}
            </label>
            <p className="inx-search-result" role="status">{keyword ? `找到 ${visible.length} 条相关报道` : `${entries.length} 条已载入报道 · 按原发布日期展示`}</p>
          </div>
        </header>

        {visible.length ? <ol className="inx-archive-list">
          {visible.map((post) => <li className="inx-archive-row" key={post.slug}>
            <div className="inx-archive-date"><NewsDate post={post} /></div>
            <Link className="inx-archive-image-link" to={`/posts/${post.slug}`} aria-label={`阅读：${post.title}`} tabIndex={-1}><NewsImage post={post} /></Link>
            <div className="inx-archive-copy"><h3><Link to={`/posts/${post.slug}`}>{post.title}</Link></h3><div className="inx-archive-meta"><SourceCount post={post} /><FocusButton post={post} onFocus={onFocus} compact /></div></div>
            <Link className="inx-archive-open" to={`/posts/${post.slug}`} aria-label={`阅读全文：${post.title}`}><ArrowUpRight size={23} strokeWidth={1.25} aria-hidden="true" /></Link>
          </li>)}
        </ol> : <div className="inx-empty"><h3>{keyword ? '没有找到相关报道。' : '暂无已载入报道。'}</h3><p>{keyword ? '可以尝试公司、技术或标题中的其他关键词。' : '报道载入后会显示在这里。'}</p>{keyword ? <button type="button" onClick={() => setQuery('')}>清除搜索<ArrowRight size={17} aria-hidden="true" /></button> : null}</div>}
      </section>

      <footer className="inx-bottom-line"><span>AI. / NEWSROOM ARCHIVE</span><Link to="/archive">浏览完整归档<ArrowUpRight size={16} aria-hidden="true" /></Link></footer>
    </div>
  </div>
}
