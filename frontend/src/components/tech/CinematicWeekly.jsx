import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Rss, Search, X } from 'lucide-react'
import SectionCover from '../news/cinematic/SectionCover'
import { formatDate, parseDate } from '../../utils/date'
import { buildSubscriptionCenterHref } from '../../utils/subscriptionLinks'
import '../../styles/cinematic-weekly.css'

const articleHref = (post) => `/posts/${encodeURIComponent(post.slug)}`
const issueNumber = (index) => String(index + 1).padStart(2, '0')
const positiveCount = (value) => Number.isFinite(Number(value)) && Number(value) > 0

function IssueMetadata({ post }) {
  return <div className="cweekly-metadata">
    {parseDate(post.created_at) ? <time dateTime={post.created_at}>发布 {formatDate(post.created_at)}</time> : <span>发布日期未提供</span>}
    {post.coverage_date ? <span>覆盖 {post.coverage_date}</span> : null}
    {positiveCount(post.source_count) ? <span>{post.source_count} 个来源</span> : null}
    {positiveCount(post.reading_time) ? <span>{post.reading_time} 分钟阅读</span> : null}
  </div>
}

function WeeklyShowcase({ posts }) {
  const [selectedSlug, setSelectedSlug] = useState(null)
  const hero = useRef(null)
  const reduced = useReducedMotion()
  const selectedIndex = Math.max(0, posts.findIndex((post) => post.slug === selectedSlug))
  const current = posts[selectedIndex]
  const next = posts[(selectedIndex + 1) % posts.length]
  const { scrollYProgress } = useScroll({ target: hero, offset: ['start start', 'end start'] })
  const progress = useSpring(scrollYProgress, { stiffness: 180, damping: 30, mass: 0.4 })
  const coverY = useTransform(progress, [0, 1], [0, -65])
  const coverRotate = useTransform(progress, [0, 1], [3, -1])
  const goTo = (direction) => setSelectedSlug(posts[(selectedIndex + direction + posts.length) % posts.length].slug)
  const timing = { duration: reduced ? 0 : 0.48, ease: [0.22, 1, 0.36, 1] }

  return <section ref={hero} className="cinema-hero cweekly-hero" aria-labelledby="cweekly-title">
    <div className="cweekly-orbit" aria-hidden="true"><span /><span /><span /></div>
    <div className="cweekly-masthead"><span className="cinema-kicker">THE LONG VIEW / WEEKLY EDITIONS</span><span className="cweekly-masthead__note">把变化，读深。</span></div>
    <div className="cweekly-heading"><h1 id="cweekly-title">AI 周报<span aria-hidden="true">.</span></h1><p>从一周的消息，看到更长的脉络。</p></div>

    <motion.div className="cweekly-exhibition" style={reduced ? undefined : { y: coverY, rotate: coverRotate }} aria-hidden="true">
      {posts.length > 1 ? <div className="cweekly-cover-behind" key={`behind:${next.slug}`}><SectionCover src={next.cover_image} title={next.title} /><span>THE NEXT PERSPECTIVE</span></div> : null}
      <div className="cweekly-cover-stage">
        <AnimatePresence initial={false}>
          <motion.div className="cweekly-cover-panel" key={current.slug} initial={{ opacity: 0, x: reduced ? 0 : 30, scale: reduced ? 1 : 1.025 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: reduced ? 0 : -20 }} transition={timing}>
            <SectionCover src={current.cover_image} title={current.title} eager={selectedIndex === 0} />
            <div className="cweekly-cover-ink"><span>AI OBSERVER <b>WEEKLY</b></span><span>{parseDate(current.created_at) ? formatDate(current.created_at) : '日期待补充'}</span></div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="cweekly-exhibition__caption"><span>每一期，保留时间与来源。</span><span>{issueNumber(selectedIndex)} / {String(posts.length).padStart(2, '0')}</span></div>
    </motion.div>

    <div className="cweekly-editorial">
      <div className="cweekly-current-label"><span />{selectedIndex === 0 ? '最新一期' : '回看这一期'}<span className="cweekly-current-label__number">EDITION / {issueNumber(selectedIndex)}</span></div>
      <motion.article key={current.slug} initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...timing, duration: reduced ? 0 : 0.32 }} data-story-slug={current.slug}>
        <h2><Link to={articleHref(current)}>{current.title}</Link></h2>
        {current.summary ? <p className="cweekly-summary">{current.summary}</p> : null}
        <IssueMetadata post={current} />
        <Link className="cinema-button cweekly-read" to={articleHref(current)} aria-label={`阅读这一期：${current.title}`}>展开这一期 <ArrowUpRight size={17} aria-hidden="true" /></Link>
      </motion.article>
    </div>

    <div className="cweekly-hero-bottom">
      <a href="#weekly-library" className="cweekly-library-jump">浏览周报书架 <ArrowDown size={16} aria-hidden="true" /></a>
      {posts.length > 1 ? <div className="cweekly-switcher" role="group" aria-label="切换周报封面"><button type="button" onClick={() => goTo(-1)} aria-label="上一期封面"><ArrowLeft size={18} aria-hidden="true" /></button><span aria-live="polite">{issueNumber(selectedIndex)}<i> / {String(posts.length).padStart(2, '0')}</i></span><button type="button" onClick={() => goTo(1)} aria-label="下一期封面"><ArrowRight size={18} aria-hidden="true" /></button></div> : null}
      <span className="cweekly-hero-bottom__caption">READ THE SIGNAL. KEEP THE CONTEXT.</span>
    </div>
  </section>
}

function WeeklyLibrary({ posts }) {
  const [query, setQuery] = useState('')
  const searchText = query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => posts.filter((post) => !searchText || `${post.title || ''} ${post.summary || ''} ${post.coverage_date || ''} ${formatDate(post.created_at)}`.toLocaleLowerCase().includes(searchText)), [posts, searchText])
  const reduced = useReducedMotion()
  const canReveal = !reduced && typeof IntersectionObserver !== 'undefined'

  return <section id="weekly-library" className="cinema-body cweekly-library" aria-labelledby="cweekly-library-title">
    <header className="cinema-section-heading cweekly-library-heading"><div><span className="cinema-kicker">THE WEEKLY LIBRARY</span><h2 id="cweekly-library-title">周报书架<span>{String(posts.length).padStart(2, '0')}</span></h2></div><p>不是滚动的消息流。<br />挑一期，留一点时间读完整。</p></header>
    <div className="cweekly-library-toolbar"><p>按原发布日期排列 · 本页已载入 {posts.length} 期</p><div className="cweekly-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="搜索已载入周报" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、日期、关键词" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="清空周报搜索"><X size={16} aria-hidden="true" /></button> : null}</div></div>
    {filtered.length ? <div className="cweekly-library-grid">{filtered.map((post, index) => <motion.article className="cweekly-library-issue" key={post.slug} initial={canReveal ? { opacity: 0, y: 24 } : false} whileInView={canReveal ? { opacity: 1, y: 0 } : undefined} viewport={{ once: true, amount: 0.08 }} transition={{ duration: reduced ? 0 : 0.45, delay: reduced ? 0 : Math.min(index % 2 * 0.07, 0.07) }} data-story-slug={post.slug}>
      <Link to={articleHref(post)} className="cweekly-library-cover" aria-label={`阅读周报封面：${post.title}`}><SectionCover src={post.cover_image} title={post.title} /><span className="cweekly-library-cover__label">AI OBSERVER / WEEKLY<ArrowUpRight size={20} aria-hidden="true" /></span></Link>
      <div className="cweekly-library-copy"><span className="cweekly-library-number" aria-hidden="true">{issueNumber(posts.indexOf(post))}</span><div><IssueMetadata post={post} /><h3><Link to={articleHref(post)}>{post.title}</Link></h3>{post.summary ? <p>{post.summary}</p> : null}<Link className="cweekly-library-read" to={articleHref(post)} aria-label={`阅读全文：${post.title}`}>阅读这一期 <ArrowUpRight size={16} aria-hidden="true" /></Link></div></div>
    </motion.article>)}</div> : <p className="cweekly-no-results" role="status">没有找到相关周报。试试其他关键词。</p>}
    <div className="cweekly-archive-end"><span>搜索范围为本页已载入周报。</span><Link to="/archive">进入全部归档 <ArrowRight size={17} aria-hidden="true" /></Link></div>
  </section>
}

export default function CinematicWeekly({ posts = [], loading = false, error = '', onRetry, feedUrl }) {
  return <div className="cinematic-weekly" data-ui="tech-weekly-edition">
    {loading || error || !posts.length ? <section className="cinema-hero cinema-state cweekly-state" aria-busy={loading}>
      <span className="cinema-kicker">THE LONG VIEW / WEEKLY EDITIONS</span><h1>AI 周报</h1>
      {loading ? <p role="status">正在载入 AI 周报…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="cinema-button" onClick={onRetry}>重新加载栏目 <ArrowRight size={17} aria-hidden="true" /></button></div> : <><h2>AI 周报 暂时还没有内容</h2><p>新的周报发布后，会展示在这里。</p><Link className="cinema-button" to="/daily">先读 AI 日报 <ArrowRight size={17} aria-hidden="true" /></Link></>}
    </section> : <WeeklyShowcase posts={posts} />}
    <nav className="cweekly-subscriptions" aria-label="周报订阅与栏目"><a href={feedUrl} target="_blank" rel="noreferrer"><Rss size={15} aria-hidden="true" />订阅 AI 周报 RSS</a><Link to={buildSubscriptionCenterHref({ contentType: 'weekly_review' })}>订阅这个栏目 <ArrowUpRight size={16} aria-hidden="true" /></Link><Link to="/daily">AI 日报 <ArrowUpRight size={16} aria-hidden="true" /></Link></nav>
    {!loading && !error && posts.length > 0 ? <WeeklyLibrary posts={posts} /> : null}
  </div>
}
