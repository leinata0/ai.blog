import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Rss, X } from 'lucide-react'
import LoadingSkeletonSet from '../../LoadingSkeletonSet'
import { formatDate } from '../../../utils/date'
import { proxyImageUrl } from '../../../utils/proxyImage'
import { buildSubscriptionCenterHref } from '../../../utils/subscriptionLinks'
import IssueNewsIndex from './IssueNewsIndex'
import useReelScroll from './useReelScroll'
import './issue.css'

const EMPTY_POSTS = []
const postPath = (post) => `/posts/${encodeURIComponent(post.slug)}`
const chapterAt = (progress) => progress < 1 / 3 ? 0 : progress < 2 / 3 ? 1 : 2
const sceneSpring = { stiffness: 260, damping: 32, mass: .45, restDelta: .0001 }
const sceneEase = [.22, 1, .36, 1]

function ReportMetadata({ post }) {
  const date = formatDate(post.created_at)
  return <>
    {date ? <time dateTime={post.created_at}>{date}</time> : <span>发布日期未提供</span>}
    {post.coverage_date ? <span>覆盖 {post.coverage_date}</span> : null}
    {Number(post.source_count) > 0 ? <span>{post.source_count} 个原始来源</span> : null}
    {Number(post.reading_time) > 0 ? <span>{post.reading_time} 分钟阅读</span> : null}
  </>
}

function useWideScene() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 901px)').matches))
  useEffect(() => {
    const query = window.matchMedia?.('(min-width: 901px)')
    const update = () => setWide(Boolean(query?.matches))
    query?.addEventListener?.('change', update)
    update()
    return () => query?.removeEventListener?.('change', update)
  }, [])
  return wide
}

export function ArticleCover({ post, eager = false }) {
  const src = proxyImageUrl(post.cover_image)
  const [failed, setFailed] = useState('')
  const unavailable = src ? '本报道封面暂不可用' : '本报道暂无封面'
  return src && failed !== src ? <img src={src} alt="" width="1672" height="941" loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : undefined} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : <span className="issue-image-fallback" role="img" aria-label={`${post.title}：${unavailable}`}>{unavailable}</span>
}

function SceneImage({ post, progress, index, animated, reduce }) {
  const boundary = index / 3
  const opacity = useTransform(progress, [boundary - .09, boundary + .09], [0, 1])
  const scale = useTransform(progress, [Math.max(0, boundary - 1 / 3), Math.min(1, boundary + 1 / 3)], [1.045, 1])
  const y = useTransform(progress, [0, 1], [10, -10])
  return <motion.div className="issue-scene-image" aria-hidden="true" style={animated ? { opacity: index ? opacity : 1, zIndex: index } : undefined} initial={animated || reduce ? false : { opacity: 0 }} animate={animated ? undefined : { opacity: 1 }} exit={animated ? undefined : { opacity: 0 }} transition={{ duration: reduce ? 0 : .45, ease: sceneEase }}>
    <motion.div className="issue-scene-image-inner" style={animated ? { scale, y } : undefined} initial={animated || reduce ? false : { scale: 1.025 }} animate={animated ? undefined : { scale: 1 }} transition={{ duration: reduce ? 0 : .65, ease: sceneEase }}><ArticleCover post={post} eager={index === 0} /></motion.div>
  </motion.div>
}

function StoryCopy({ post, index, progress, animated, reduce, onPreview }) {
  const start = index / 3
  const end = (index + 1) / 3
  // Swap the single readable headline at the quiet midpoint of the dissolve,
  // rather than queueing an exit animation behind every scroll threshold.
  const opacity = useTransform(progress, [start, start + .065, end - .065, end], [index ? 0 : 1, 1, 1, index === 2 ? 1 : 0])
  const y = useTransform(progress, [start, start + .065, end - .065, end], [index ? 10 : 0, 0, 0, index === 2 ? 0 : -10])
  return <motion.div className="issue-story-copy" style={animated ? { opacity, y } : undefined} initial={animated || reduce ? false : { opacity: 0, y: 8 }} animate={animated ? undefined : { opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .22, ease: sceneEase }}>
    <h1>{post.title}</h1>
    <div className="issue-story-meta"><ReportMetadata post={post} /></div>
    <div className="issue-story-actions"><Link to={postPath(post)} className="issue-read-link">阅读报道 <ArrowUpRight size={20} /></Link><button onClick={() => onPreview(post)}>先看摘要 <span>↗</span></button></div>
  </motion.div>
}

function StoryDetails({ post, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog className="issue-dialog" ref={ref} aria-labelledby="issue-dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <button className="issue-dialog-close" onClick={onClose} aria-label="关闭报道预览" autoFocus><X size={22} /></button>
    <div className="issue-dialog-image"><ArticleCover post={post} eager /></div>
    <div className="issue-dialog-copy"><span className="issue-mono">READING PREVIEW / 报道预览</span><h2 id="issue-dialog-title">{post.title}</h2><p className="issue-dialog-meta"><ReportMetadata post={post} /></p>{post.summary ? <p>{post.summary}</p> : null}<Link to={postPath(post)} className="issue-read-link">阅读全文 <ArrowUpRight size={19} /></Link></div>
  </dialog>
}

function StoryReel(props) {
  const reduce = useReducedMotion()
  const wide = useWideScene()
  const animated = wide && !reduce && props.stories.length === 3
  // Each layout owns its scroll measurement and derived image transforms.
  // A mobile scroll range must not carry into the taller desktop sequence.
  return <StoryReelScene key={animated ? 'scroll' : 'static'} {...props} animated={animated} reduce={reduce} />
}

function StoryReelScene({ stories, request, onPreview, animated, reduce, caption }) {
  const track = useRef(null)
  const [active, setActive] = useState(0)
  const currentChapter = useRef(0)
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] })
  // Keep the image layers and selected report on one damped clock. A derived
  // spring also avoids a separate native ViewTimeline for each image property.
  const progress = useSpring(scrollYProgress, sceneSpring)
  const goTo = useReelScroll(track)
  const selected = stories[active] || stories[0]
  const select = useCallback((index) => {
    if (!animated) { currentChapter.current = index; setActive(index); track.current?.scrollIntoView?.({ behavior: reduce ? 'instant' : 'smooth', block: 'start' }); return }
    goTo(index)
  }, [animated, reduce, goTo])
  const step = (direction) => {
    const next = (pending) => ((pending ?? currentChapter.current) + direction + stories.length) % stories.length
    if (animated) goTo(next)
    else select(next())
  }
  useMotionValueEvent(progress, 'change', (value) => {
    const next = chapterAt(value)
    if (animated && currentChapter.current !== next) { currentChapter.current = next; setActive(next) }
  })
  useEffect(() => {
    if (!animated) return
    const next = chapterAt(progress.get())
    currentChapter.current = next
    setActive(next)
  }, [animated, progress])
  useEffect(() => {
    if (!request) return
    const index = stories.findIndex((post) => post.slug === request.slug)
    if (index >= 0) select(index)
  }, [request, stories, select])
  return <section ref={track} className={`issue-reel${animated ? ' issue-reel--scroll' : ''}`} aria-label="日报焦点报道">
    <div className="issue-stage">
      <div className="issue-scene-images">{animated ? stories.map((post, index) => <SceneImage key={`${index}:${post.slug}`} post={post} index={index} progress={progress} animated reduce={reduce} />) : <AnimatePresence initial={false}><SceneImage key={selected.slug} post={selected} index={0} progress={progress} animated={false} reduce={reduce} /></AnimatePresence>}</div>
      <div className="issue-scene-shade" />
      <div className="issue-edition-label"><span>AI DAILY</span><span>新闻 / 观点 / 原始来源</span><span className="issue-edition-number">{String(stories.length).padStart(2, '0')}</span></div>
      <div className="issue-scene-grid" aria-hidden="true"><span /><span /></div>
      <div className="issue-story-heading"><p className="issue-focus-tag"><span />AI 日报<span className="issue-focus-divider">/</span>焦点报道 <span className="issue-focus-order">{String(active + 1).padStart(2, '0')} — {String(stories.length).padStart(2, '0')}</span></p><StoryCopy key={selected.slug} post={selected} index={active} progress={progress} animated={animated} reduce={reduce} onPreview={onPreview} /></div>
      <div className="issue-story-rail"><div className="issue-rail-caption"><ArrowDown size={15} /><span>{animated ? '向下滚动，进入下一条报道' : stories.length > 1 ? '选择一条焦点报道' : '最新焦点报道'}</span></div><nav aria-label="选择焦点报道">{stories.map((post, index) => <button key={post.slug} onClick={() => select(index)} aria-label={`切换焦点：${post.title}`} aria-pressed={active === index}><span className="issue-rail-number">{String(index + 1).padStart(2, '0')} </span><span>{post.title}</span><ArrowUpRight size={15} /></button>)}</nav>{stories.length > 1 ? <div className="issue-rail-arrows"><button onClick={() => step(-1)} aria-label="上一条焦点报道"><ArrowLeft size={19} /></button><button onClick={() => step(1)} aria-label="下一条焦点报道"><ArrowRight size={19} /></button></div> : null}</div>
      <div className="issue-scene-caption"><span>当前报道配图</span><span>{caption}</span></div>
    </div>
  </section>
}

export default function DailyEdition({ posts = EMPTY_POSTS, featuredPosts, loading = false, error = '', onRetry, feedUrl, header, footer, className = 'issue-live', note, caption = '按原发布日期展示' }) {
  const [preview, setPreview] = useState(null)
  const [extraFocus, setExtraFocus] = useState(null)
  const [request, setRequest] = useState(null)
  const sceneEnd = useRef(null)
  const [paperHeader, setPaperHeader] = useState(false)
  const defaultFocus = useMemo(() => (featuredPosts || posts).slice(0, 3), [featuredPosts, posts])
  const stories = useMemo(() => {
    const extra = posts.find((post) => post.slug === extraFocus)
    return extra ? [extra, ...defaultFocus.filter((post) => post.slug !== extra.slug)].slice(0, 3) : defaultFocus
  }, [extraFocus, posts, defaultFocus])
  const focus = (slug) => {
    setExtraFocus(defaultFocus.some((post) => post.slug === slug) ? null : slug)
    setRequest({ slug })
  }
  useEffect(() => {
    let frame = 0
    let previous
    const update = () => {
      frame = 0
      if (!sceneEnd.current) return
      const next = sceneEnd.current.getBoundingClientRect().top < 90
      if (next !== previous) { previous = next; setPaperHeader(next) }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    // A direct jump can skip a one-pixel IntersectionObserver sentinel entirely.
    // Coalesce passive scroll reads and only render when the surface changes.
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    update()
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [loading, error, posts.length])
  return <div className={`issue-demo ${className}${paperHeader ? ' issue-paper-header' : ''}`} data-design="cinematic-03">
    {header}
    <main id="main-content">
      {loading || error || !posts.length ? <section className="issue-state" aria-busy={loading || undefined}>
        <p className="issue-mono">AI DAILY / AI 日报</p><h1>AI 日报</h1>
        {loading ? <><p role="status">正在载入日报…</p><LoadingSkeletonSet count={1} minHeight="12rem" /></> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重新加载栏目</button></div> : <><h2>AI 日报 暂时还没有内容</h2><p>新的栏目文章发布后，会优先展示在这里。</p></>}
      </section> : <StoryReel key={posts[0].slug} stories={stories} request={request} onPreview={setPreview} caption={caption} />}
      <div ref={sceneEnd} aria-hidden="true" style={{ height: 1 }} />
      {feedUrl ? <nav className="issue-subscriptions" aria-label="日报订阅"><a href={feedUrl} target="_blank" rel="noreferrer"><Rss size={15} aria-hidden="true" />订阅 AI 日报 RSS</a><Link to={buildSubscriptionCenterHref({ contentType: 'daily_brief' })}>订阅这个栏目<ArrowUpRight size={16} aria-hidden="true" /></Link><Link to="/archive">全部归档<ArrowUpRight size={16} aria-hidden="true" /></Link></nav> : null}
      {!loading && !error && posts.length > 0 ? <IssueNewsIndex posts={posts} onFocus={focus} note={note} /> : null}
    </main>
    {footer}
    {preview ? <StoryDetails key={preview.slug} post={preview} onClose={() => setPreview(null)} /> : null}
  </div>
}
