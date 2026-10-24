import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronDown, ImageOff, Search, X } from 'lucide-react'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'
import './gallery-index.css'

const INDEX_LABELS = {
  daily: ['NEWS ARCHIVE', '每一条变化，都值得看清。'],
  weekly: ['WEEKLY TIMELINE', '把一周，放进更大的时间里。'],
  topics: ['FIELD NOTES', '沿着图像，找到你的关注点。'],
  series: ['CURATED COLLECTIONS', '一个问题，值得持续展开。'],
  'start-here': ['CHOOSE YOUR PATH', '从你想了解的事情出发。'],
}

function IndexImage({ image, className = '' }) {
  const src = proxyImageUrl(image)
  const [failed, setFailed] = useState('')
  return <span className={`gx-index-image ${className}`}>
    {src && failed !== src
      ? <img src={src} alt="" width="900" height="600" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
      : <span className="gx-index-image-fallback"><ImageOff size={24} strokeWidth={1} aria-hidden="true" /><span>{src ? '封面暂不可用' : '文字档案'}</span></span>}
  </span>
}

function PublishedDate({ date, prefix = false }) {
  const formatted = formatDate(date)
  return formatted ? <time dateTime={date}>{prefix ? '发布于 ' : ''}{formatted}</time> : <span>发布日期未提供</span>
}

function ArticleCount({ count, suffix = '篇文章' }) {
  return Number.isFinite(Number(count)) && count !== null && count !== '' && count !== undefined
    ? <span>{Number(count)} {suffix}</span>
    : <span>内容档案</span>
}

function ArchiveIndex({ entries, activeId, onSelect }) {
  const [query, setQuery] = useState('')
  const keyword = query.trim().toLocaleLowerCase()
  const visible = keyword ? entries.filter((entry) => `${entry.title} ${entry.summary || ''}`.toLocaleLowerCase().includes(keyword)) : entries
  return <div className="gx-index-archive">
    <div className="gx-index-archive-tools">
      <p><span className="gx-index-dot" aria-hidden="true" />{entries.length} 条已载入报道<span className="gx-index-tool-hint">按原发布日期排列</span></p>
      <div className="gx-index-search">
        <Search size={18} strokeWidth={1.4} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="寻找一个问题、公司或关键词" aria-label="搜索新闻档案" type="search" />
        {query ? <button type="button" onClick={() => setQuery('')} aria-label="清空档案搜索"><X size={17} aria-hidden="true" /></button> : null}
      </div>
    </div>
    <p className="gx-index-search-result" role="status">{keyword ? `找到 ${visible.length} 条相关报道` : '选择一条报道，在上方展台查看。'}</p>
    {visible.length ? <ol className="gx-index-archive-list">
      {visible.map((entry) => <li key={entry.id}>
        <button type="button" className={`gx-index-archive-row ${activeId === entry.id ? 'gx-index-is-active' : ''}`} aria-label={`在展台查看：${entry.title}`} aria-pressed={activeId === entry.id} onClick={() => onSelect(entry.id)}>
          <span className="gx-index-archive-number" aria-hidden="true">{String(entries.indexOf(entry) + 1).padStart(2, '0')}</span>
          <IndexImage image={entry.image} />
          <span className="gx-index-archive-copy"><span className="gx-index-archive-title">{entry.title}</span><span className="gx-index-archive-state">{activeId === entry.id ? '当前展出' : '查看报道'}</span></span>
          <span className="gx-index-archive-date"><PublishedDate date={entry.date} /></span>
          <ArrowUpRight className="gx-index-row-arrow" size={25} strokeWidth={1.2} aria-hidden="true" />
        </button>
      </li>)}
    </ol> : <div className="gx-index-empty"><span aria-hidden="true">∅</span><h3>还没有找到这条线索。</h3><p>试试标题中的公司、模型或技术名称。</p><button type="button" onClick={() => setQuery('')}>清除搜索 <ArrowRight size={17} aria-hidden="true" /></button></div>}
  </div>
}

function WeeklyIndex({ entries, activeId, onSelect }) {
  const cards = useRef([])
  const [focused, setFocused] = useState(0)
  const focusCard = (index) => {
    const next = Math.min(Math.max(index, 0), entries.length - 1)
    if (next >= 0) cards.current[next]?.focus()
  }
  return <div className="gx-index-weekly">
    <div className="gx-index-timeline-tools"><p>以真实发布日期，回看每一个观察切片。</p><div><button type="button" onClick={() => focusCard(focused - 1)} disabled={focused === 0} aria-label="上一张周报封面"><ArrowLeft size={20} aria-hidden="true" /></button><button type="button" onClick={() => focusCard(focused + 1)} disabled={!entries.length || focused === entries.length - 1} aria-label="下一张周报封面"><ArrowRight size={20} aria-hidden="true" /></button></div></div>
    <ol className="gx-index-timeline" aria-label="周报发布日期时间带">
      {entries.map((entry, index) => <li key={entry.id}>
        <button type="button" ref={(element) => { cards.current[index] = element }} onFocus={() => setFocused(index)} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); focusCard(index + (event.key === 'ArrowRight' ? 1 : -1)) } }} onClick={() => onSelect(entry.id)} className={`gx-index-weekly-card ${activeId === entry.id ? 'gx-index-is-active' : ''}`} aria-label={`在展台查看：${entry.title}`} aria-pressed={activeId === entry.id}>
          <span className="gx-index-weekly-date"><span className="gx-index-timeline-node" aria-hidden="true" /><PublishedDate date={entry.date} prefix /></span>
          <span className="gx-index-weekly-cover"><IndexImage image={entry.image} /><span className="gx-index-weekly-open"><ArrowUpRight size={27} strokeWidth={1.2} aria-hidden="true" /></span>{activeId === entry.id ? <span className="gx-index-cover-badge">正在展出</span> : null}</span>
          <span className="gx-index-weekly-caption"><strong>{entry.title}</strong><span>WEEKLY OBSERVATION <ArrowRight size={17} aria-hidden="true" /></span></span>
        </button>
      </li>)}
    </ol>
    {!entries.length ? <p className="gx-index-no-entries">暂未载入周报档案。</p> : <p className="gx-index-drag-hint"><ArrowLeft size={15} aria-hidden="true" />横向滚动浏览封面，也可以用方向键选择<ArrowRight size={15} aria-hidden="true" /></p>}
  </div>
}

function TopicIndex({ entries, activeId, onSelect }) {
  return <div className="gx-index-topics">
    <div className="gx-index-topic-intro"><p>从一个主题出发，继续追踪它的下一步。</p><span>{entries.length} 个已载入主题 / IMAGE INDEX</span></div>
    <ul className="gx-index-topic-board">
      {entries.map((entry, index) => <li key={entry.id} className={`gx-index-topic-tile gx-index-topic-tile-${index % 4}`}>
        <button type="button" className={activeId === entry.id ? 'gx-index-is-active' : ''} onClick={() => onSelect(entry.id)} aria-label={`在展台查看：${entry.title}`} aria-pressed={activeId === entry.id}>
          <span className="gx-index-topic-media"><IndexImage image={entry.image} /><span className="gx-index-topic-coordinate" aria-hidden="true">FIELD / {String(index + 1).padStart(2, '0')}</span><span className="gx-index-topic-view"><ArrowUpRight size={30} strokeWidth={1.1} aria-hidden="true" /></span>{activeId === entry.id ? <span className="gx-index-cover-badge">正在展出</span> : null}</span>
          <span className="gx-index-topic-caption"><strong>{entry.title}</strong><span><ArticleCount count={entry.count} /></span></span>
          {entry.summary ? <span className="gx-index-topic-description">{entry.summary}</span> : null}
        </button>
      </li>)}
    </ul>
    {!entries.length ? <p className="gx-index-no-entries">暂未载入主题档案。</p> : null}
  </div>
}

function postHref(post) {
  return post.url || (post.slug ? `/posts/${encodeURIComponent(post.slug)}` : '')
}

function SeriesIndex({ entries, activeId, onSelect }) {
  const firstId = entries[0]?.id
  const [expanded, setExpanded] = useState(activeId || firstId)
  const sectionId = useId()
  useEffect(() => { setExpanded(activeId || firstId) }, [activeId, firstId])
  return <div className="gx-index-series">
    <p className="gx-index-series-intro">展开一个系列，查看已收录的文章；也可以把它放回展台，先从全貌开始。</p>
    <div className="gx-index-series-list">
      {entries.map((entry, index) => {
        const open = expanded === entry.id
        const posts = (entry.posts || []).filter((post) => postHref(post))
        const titleId = `${sectionId}-title-${index}`
        const panelId = `${sectionId}-panel-${index}`
        return <article key={entry.id} className={`gx-index-series-item ${open ? 'gx-index-is-expanded' : ''}`}>
          <h3><button id={titleId} type="button" className="gx-index-series-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setExpanded(open ? null : entry.id)}>
            <span className="gx-index-series-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span className="gx-index-series-name">{entry.title}</span><span className="gx-index-series-count"><ArticleCount count={entry.count} /></span><ChevronDown size={25} strokeWidth={1.3} aria-hidden="true" />
          </button></h3>
          <div id={panelId} className="gx-index-series-panel" role="region" aria-labelledby={titleId} hidden={!open}>
            {open ? <><div className="gx-index-series-identity"><IndexImage image={entry.image} /><div><span className="gx-index-series-label">COLLECTION / 专题策展</span>{entry.summary ? <p>{entry.summary}</p> : null}<button type="button" className="gx-index-series-stage" onClick={() => onSelect(entry.id)} aria-label={`在展台查看：${entry.title}`}>{activeId === entry.id ? '回到当前展台' : '在展台查看'}<ArrowUpRight size={17} aria-hidden="true" /></button></div></div>
              <div className="gx-index-series-directory"><div className="gx-index-directory-heading"><span>文章目录</span><span>{posts.length} 篇已载入</span></div>{posts.length ? <ol>{posts.map((post, postIndex) => <li key={post.id || post.slug || post.url}><Link to={postHref(post)}><span aria-hidden="true">{String(postIndex + 1).padStart(2, '0')}</span><span>{post.title}</span><ArrowUpRight size={17} aria-hidden="true" /></Link></li>)}</ol> : <p className="gx-index-series-empty">当前预览尚未收录文章，目录准备好后会出现在这里。</p>}{entry.url ? <Link className="gx-index-series-all" to={entry.url}>打开完整系列 <ArrowRight size={16} aria-hidden="true" /></Link> : null}</div></> : null}
          </div>
        </article>
      })}
    </div>
    {!entries.length ? <p className="gx-index-no-entries">暂未载入系列档案。</p> : null}
  </div>
}

function ReadingIndex({ entries }) {
  const paths = entries.slice(0, 3)
  return <div className="gx-index-paths">
    <p className="gx-index-path-intro">没有固定的阅读顺序。选一条适合你的路，直接进入内容。</p>
    <div className="gx-index-path-list">{paths.map((entry, index) => <Link to={entry.url} key={entry.id} className={`gx-index-path gx-index-path-${index}`}>
      <span className="gx-index-path-number" aria-hidden="true">0{index + 1}</span><span className="gx-index-path-copy"><span className="gx-index-path-label">READING PATH / 选读路径</span><strong>{entry.title}</strong>{entry.summary ? <span className="gx-index-path-summary">{entry.summary}</span> : null}<span className="gx-index-path-action">进入阅读<ArrowUpRight size={18} aria-hidden="true" /></span></span><IndexImage image={entry.image} /><ArrowUpRight className="gx-index-path-arrow" size={35} strokeWidth={1} aria-hidden="true" />
    </Link>)}</div>
    {!paths.length ? <p className="gx-index-no-entries">阅读路径正在准备中。</p> : null}
  </div>
}

export default function GalleryIndex({ view, entries = [], activeId, onSelect }) {
  const label = INDEX_LABELS[view] || INDEX_LABELS.daily
  return <section id="gx-explore" className={`gx-index gx-index-view-${view}`} aria-labelledby="gx-index-heading">
    <div className="gx-index-heading"><div><span className="gx-index-eyebrow">{label[0]} / 内容索引</span><h2 id="gx-index-heading">在这里，<br className="gx-index-heading-break" />继续探索<span>。</span></h2></div><div className="gx-index-heading-note"><p>{label[1]}</p><span>SCROLL TO DISCOVER<ArrowDown size={17} strokeWidth={1.2} aria-hidden="true" /></span></div></div>
    {view === 'weekly' ? <WeeklyIndex entries={entries} activeId={activeId} onSelect={onSelect} /> : view === 'topics' ? <TopicIndex entries={entries} activeId={activeId} onSelect={onSelect} /> : view === 'series' ? <SeriesIndex entries={entries} activeId={activeId} onSelect={onSelect} /> : view === 'start-here' ? <ReadingIndex entries={entries} /> : <ArchiveIndex entries={entries} activeId={activeId} onSelect={onSelect} />}
    <p className="gx-index-history-note">本预览使用站内历史内容，文章与封面保留原始对应关系，日期为原发布日期。</p>
  </section>
}
