import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, CalendarDays, ChevronDown, Clock3, ImageOff, Search, X } from 'lucide-react'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'

export function DemoImage({ post, eager = false, className = '' }) {
  const src = proxyImageUrl(post?.cover_image)
  const [failed, setFailed] = useState('')
  return <div className={`su-image ${className}`}>
    {src && failed !== src ? <img src={src} alt="" width="1536" height="1024" loading={eager ? 'eager' : 'lazy'} decoding="async" fetchpriority={eager ? 'high' : undefined} referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : <span className="su-image-empty"><ImageOff size={26} aria-hidden="true" />{src ? '封面暂不可用' : '暂无封面'}</span>}
  </div>
}

function StoryMeta({ post }) {
  return <div className="su-meta"><time dateTime={post.created_at}>{formatDate(post.created_at)}</time>{Number(post.source_count) > 0 ? <span>{post.source_count} 个来源</span> : null}{Number(post.reading_time) > 0 ? <span><Clock3 size={12} aria-hidden="true" />{post.reading_time} 分钟</span> : null}</div>
}

function PreviewDialog({ post, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} className="su-preview-dialog" aria-labelledby="su-preview-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <button className="su-dialog-close" onClick={onClose} aria-label="关闭文章预览" autoFocus><X size={20} /></button>
    <DemoImage post={post} eager />
    <div className="su-dialog-copy"><span className="su-eyebrow">READING PREVIEW / 文章预览</span><h2 id="su-preview-title">{post.title}</h2><StoryMeta post={post} />{post.summary ? <p>{post.summary}</p> : null}<Link to={`/posts/${encodeURIComponent(post.slug)}`} className="su-button su-button--dark">打开完整报道 <ArrowUpRight size={17} /></Link></div>
  </dialog>
}

function SmallStory({ post, onPreview }) {
  return <article className="su-small-story">
    <Link to={`/posts/${encodeURIComponent(post.slug)}`} aria-label={`阅读：${post.title}`}><DemoImage post={post} /></Link>
    <div className="su-small-story-copy"><span className="su-story-tag">NEWS / 日报</span><h3><Link to={`/posts/${encodeURIComponent(post.slug)}`}>{post.title}</Link></h3><div className="su-small-story-bottom"><time dateTime={post.created_at}>{formatDate(post.created_at)}</time><button onClick={() => onPreview(post)} aria-label={`预览：${post.title}`}>预览 <ArrowUpRight size={13} /></button></div></div>
  </article>
}

export function DailyDemo({ data }) {
  const [query, setQuery] = useState('')
  const [date, setDate] = useState('all')
  const [preview, setPreview] = useState(null)
  const posts = data.daily || []
  const dates = [...new Set(posts.map((post) => post.created_at?.slice(0, 10)).filter(Boolean))]
  const results = useMemo(() => posts.filter((post) => {
    const term = query.trim().toLocaleLowerCase()
    return (!term || `${post.title} ${post.summary || ''}`.toLocaleLowerCase().includes(term)) && (date === 'all' || post.created_at?.startsWith(date))
  }), [posts, query, date])
  const [lead, ...rest] = results
  const filtering = query.trim() || date !== 'all'
  return <>
    <section className="su-section-heading"><div><div className="su-eyebrow"><span className="su-dot" />THE DAILY / 每日观察</div><h1>AI 日报<span>把变化，看清楚。</span></h1></div><p>模型、产品、研究与产业。<br />从重要消息开始，沿原始来源继续阅读。</p></section>
    <div className="su-toolbar"><div className="su-filter-pills"><span className="su-active-filter">最新发布</span><Link to="/demo/sections/weekly">每周深读 <ArrowUpRight size={13} /></Link></div><div className="su-toolbar-controls"><label className="su-select"><CalendarDays size={15} aria-hidden="true" /><select aria-label="按发布日期筛选" value={date} onChange={(event) => setDate(event.target.value)}><option value="all">全部样本日期</option>{dates.map((item) => <option key={item} value={item}>{item.replaceAll('-', '/')}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label><label className="su-search"><Search size={16} aria-hidden="true" /><input aria-label="筛选日报样本" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜一条新闻…" />{query ? <button onClick={() => setQuery('')} aria-label="清空日报搜索"><X size={14} /></button> : null}</label></div></div>
    {filtering ? <p className="su-results" role="status">找到 {results.length} 篇报道 <button onClick={() => { setQuery(''); setDate('all') }}>查看全部样本 <X size={12} /></button></p> : null}
    {!lead ? <div className="su-empty"><Search size={28} aria-hidden="true" /><h2>这组样本里还没有这条线索</h2><p>试试模型、公司或报道中的关键词。</p><button className="su-button" onClick={() => { setQuery(''); setDate('all') }}>清除筛选 <ArrowUpRight size={16} /></button></div> : <>
      <section className="su-daily-stage" aria-label="日报重点报道">
        <article className="su-lead-story"><Link to={`/posts/${encodeURIComponent(lead.slug)}`} className="su-lead-media" aria-label={`阅读焦点：${lead.title}`}><DemoImage post={lead} eager /><span className="su-media-label">IN FOCUS / 本期焦点</span><span className="su-media-arrow"><ArrowUpRight size={26} /></span></Link><div className="su-lead-copy"><div className="su-lead-meta"><span className="su-story-tag">科学 · 技术 · 产业</span><button onClick={() => setPreview(lead)}>快速预览 <ArrowUpRight size={15} /></button></div><h2><Link to={`/posts/${encodeURIComponent(lead.slug)}`}>{lead.title}</Link></h2>{lead.summary ? <p>{lead.summary}</p> : null}<StoryMeta post={lead} /></div></article>
        <aside className="su-side-stories" aria-label="更多重点报道"><div className="su-side-title"><span>继续关注</span><span>MORE SIGNALS ↘</span></div>{rest.slice(0, 2).map((post) => <SmallStory key={post.slug} post={post} onPreview={setPreview} />)}<Link to="/demo/sections/topics" className="su-topic-invitation"><span className="su-eyebrow">FOLLOW A THREAD</span><strong>沿一个主题，<br />读得更深。</strong><span>探索主题档案 <ArrowUpRight size={19} /></span></Link></aside>
      </section>
      {rest.length > 2 ? <section className="su-latest-grid" aria-labelledby="su-latest-title"><div className="su-block-heading"><h2 id="su-latest-title">新闻线索 <span>THE NEWSROOM</span></h2><span>{rest.length - 2} 篇延伸阅读 <ArrowDown size={14} /></span></div><div className="su-story-grid">{rest.slice(2).map((post) => <SmallStory key={post.slug} post={post} onPreview={setPreview} />)}</div></section> : null}
    </>}
    {preview ? <PreviewDialog key={preview.slug} post={preview} onClose={() => setPreview(null)} /> : null}
  </>
}

export function WeeklyDemo({ data }) {
  const posts = data.weekly || []
  const [year, setYear] = useState('all')
  const years = [...new Set(posts.map((post) => post.created_at?.slice(0, 4)).filter(Boolean))]
  const [latest, ...previous] = posts
  const archive = year === 'all' ? previous : previous.filter((post) => post.created_at?.startsWith(year))
  if (!latest) return <div className="su-empty"><h1>AI 周报</h1><p>本次演示暂无周报样本。</p></div>
  return <>
    <section className="su-section-heading"><div><div className="su-eyebrow"><span className="su-dot" />THE LONG VIEW / 每周深读</div><h1>AI 周报<span>给变化，多一点背景。</span></h1></div><p>把分散的消息读成一条主线。<br />每一期，保留它的时间与来源。</p></section>
    <article className="su-weekly-feature"><Link to={`/posts/${encodeURIComponent(latest.slug)}`} className="su-weekly-cover" aria-label={`阅读本期周报：${latest.title}`}><DemoImage post={latest} eager /><span className="su-weekly-cover-note">THE AI OBSERVER<br />WEEKLY REVIEW</span></Link><div className="su-weekly-feature-copy"><span className="su-eyebrow">LATEST EDITION / 最近一期</span><h2><Link to={`/posts/${encodeURIComponent(latest.slug)}`}>{latest.title}</Link></h2>{latest.summary ? <p>{latest.summary}</p> : null}<StoryMeta post={latest} />{latest.coverage_date ? <span className="su-coverage">内容覆盖 {latest.coverage_date}</span> : null}<Link to={`/posts/${encodeURIComponent(latest.slug)}`} className="su-button su-button--lime">开始阅读本期 <ArrowUpRight size={18} /></Link></div></article>
    <div className="su-weekly-reading-note"><span>READ THE FULL PICTURE</span><p>先了解主线，再核对事实与来源。历史内容记录的是当时的判断。</p><Link to="/demo/sections/start-here">阅读指南 <ArrowUpRight size={16} /></Link></div>
    <section aria-labelledby="su-weekly-archive"><div className="su-block-heading"><h2 id="su-weekly-archive">往期档案 <span>PREVIOUS EDITIONS</span></h2><label className="su-select"><select aria-label="按年份筛选往期周报" value={year} onChange={(event) => setYear(event.target.value)}><option value="all">全部年份</option>{years.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={13} /></label></div><div className="su-weekly-archive">{archive.map((post) => <article key={post.slug}><Link className="su-weekly-archive-image" to={`/posts/${encodeURIComponent(post.slug)}`} aria-label={`阅读周报：${post.title}`}><DemoImage post={post} /><ArrowUpRight size={22} /></Link><StoryMeta post={post} /><h3><Link to={`/posts/${encodeURIComponent(post.slug)}`}>{post.title}</Link></h3><Link className="su-text-link" to={`/posts/${encodeURIComponent(post.slug)}`}>阅读这一期 <ArrowUpRight size={15} /></Link></article>)}</div>{!archive.length ? <p className="su-empty">该年份暂无往期样本。</p> : null}</section>
  </>
}
