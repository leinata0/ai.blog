import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react'
import SeoMeta from '../../components/SeoMeta'
import { formatDate } from '../../utils/date'
import { proxyImageUrl } from '../../utils/proxyImage'
import IssueNewsIndex from './IssueNewsIndex'
import data from './demoContent.json'
import './issue.css'

const posts = data.daily
const defaultFocus = [posts[0], posts[1], posts[4]]
const artwork = {
  [posts[0].slug]: '/images/observer-issue/clinical-frontier.png',
  [posts[1].slug]: '/images/observer-issue/material-frontier.png',
}
const sectionLinks = [{ label: '首页', to: '/' }, { label: '日报', to: '/demo/sections/daily' }, { label: '周报', to: '/weekly' }, { label: '主题', to: '/topics' }, { label: '系列', to: '/series' }, { label: '开始阅读', to: '/start-here' }]
const postPath = (post) => `/posts/${encodeURIComponent(post.slug)}`
const chapterAt = (progress) => progress < .34 ? 0 : progress < .68 ? 1 : 2

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

function StoryImage({ post, art = false, eager = false }) {
  const original = proxyImageUrl(post.cover_image)
  const source = art ? artwork[post.slug] || original : original
  const [failed, setFailed] = useState([])
  const src = [source, original].find((candidate) => candidate && !failed.includes(candidate))
  return src ? <img src={src} alt="" width="1672" height="941" loading={eager ? 'eager' : 'lazy'} fetchpriority={eager ? 'high' : undefined} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed((current) => current.includes(src) ? current : [...current, src])} /> : <span className="issue-image-fallback">{post.title}</span>
}

function SceneImage({ post, progress, index, animated, selected }) {
  const start = index === 1 ? .25 : .59
  const end = index === 1 ? .4 : .74
  const curtain = useTransform(progress, [start, end], ['inset(100% 0 0 0)', 'inset(0% 0 0 0)'])
  const scale = useTransform(progress, [index / 3, (index + 1) / 3], [1.12, 1])
  return <motion.div className="issue-scene-image" aria-hidden="true" style={animated ? { clipPath: index ? curtain : undefined, zIndex: index } : { opacity: selected ? 1 : 0, zIndex: selected ? 1 : 0 }}>
    <motion.div className="issue-scene-image-inner" style={animated ? { scale } : undefined}><StoryImage post={post} art eager={index === 0} /></motion.div>
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
    <div className="issue-dialog-image"><StoryImage post={post} eager /></div>
    <div className="issue-dialog-copy"><span className="issue-mono">READING PREVIEW / 报道预览</span><h2 id="issue-dialog-title">{post.title}</h2><p className="issue-dialog-meta"><time dateTime={post.created_at}>{formatDate(post.created_at)}</time><span>{post.source_count} 个原始来源</span></p>{post.summary ? <p>{post.summary}</p> : null}<Link to={postPath(post)} className="issue-read-link">阅读全文 <ArrowUpRight size={19} /></Link></div>
  </dialog>
}

function StoryReel({ stories, request, onPreview }) {
  const track = useRef(null)
  const reduce = useReducedMotion()
  const wide = useWideScene()
  const animated = wide && !reduce
  const [active, setActive] = useState(0)
  const currentChapter = useRef(0)
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] })
  const selected = stories[active] || stories[0]
  const select = useCallback((index) => {
    if (!animated) { currentChapter.current = index; setActive(index); track.current?.scrollIntoView?.({ behavior: reduce ? 'instant' : 'smooth', block: 'start' }); return }
    const element = track.current
    if (!element) return
    const start = window.scrollY + element.getBoundingClientRect().top
    const travel = Math.max(0, element.offsetHeight - window.innerHeight)
    window.scrollTo({ top: start + travel * [0, .5, .94][index], behavior: 'smooth' })
  }, [animated, reduce])
  useMotionValueEvent(scrollYProgress, 'change', (progress) => {
    const next = chapterAt(progress)
    if (animated && currentChapter.current !== next) { currentChapter.current = next; setActive(next) }
  })
  useEffect(() => {
    if (!animated) return
    const next = chapterAt(scrollYProgress.get())
    currentChapter.current = next
    setActive(next)
  }, [animated, scrollYProgress])
  useEffect(() => {
    if (!request) return
    const index = stories.findIndex((post) => post.slug === request.slug)
    if (index >= 0) select(index)
  }, [request, stories, select])
  return <section ref={track} className={`issue-reel${animated ? ' issue-reel--scroll' : ''}`} aria-label="日报焦点报道">
    <div className="issue-stage">
      <div className="issue-scene-images">{animated ? stories.map((post, index) => <SceneImage key={post.slug} post={post} index={index} progress={scrollYProgress} animated selected={index === active} />) : <SceneImage key={selected.slug} post={selected} index={0} progress={scrollYProgress} animated={false} selected />}</div>
      <div className="issue-scene-shade" />
      <div className="issue-edition-label"><span>AI DAILY</span><span>新闻 / 观点 / 原始来源</span><span className="issue-edition-number">03</span></div>
      <div className="issue-scene-grid" aria-hidden="true"><span /><span /></div>
      <div className="issue-story-heading"><p className="issue-focus-tag"><span />AI 日报<span className="issue-focus-divider">/</span>焦点报道 <span className="issue-focus-order">{String(active + 1).padStart(2, '0')} — {String(stories.length).padStart(2, '0')}</span></p><AnimatePresence mode="wait" initial={false}><motion.div key={selected.slug} initial={{ opacity: 0, y: reduce ? 0 : 26 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -18 }} transition={{ duration: reduce ? 0 : .25 }}><h1>{selected.title}</h1><div className="issue-story-meta"><time dateTime={selected.created_at}>{formatDate(selected.created_at)}</time><span>{selected.source_count} 个原始来源</span><span>{selected.reading_time} 分钟阅读</span></div><div className="issue-story-actions"><Link to={postPath(selected)} className="issue-read-link">阅读报道 <ArrowUpRight size={20} /></Link><button onClick={() => onPreview(selected)}>先看摘要 <span>↗</span></button></div></motion.div></AnimatePresence></div>
      <div className="issue-story-rail"><div className="issue-rail-caption"><ArrowDown size={15} /><span>{animated ? '向下滚动，进入下一条报道' : '选择一条焦点报道'}</span></div><nav aria-label="选择焦点报道">{stories.map((post, index) => <button key={post.slug} onClick={() => select(index)} aria-label={`切换焦点：${post.title}`} aria-pressed={active === index}><span className="issue-rail-number">{String(index + 1).padStart(2, '0')}</span><span>{post.title}</span><ArrowUpRight size={15} /></button>)}</nav><div className="issue-rail-arrows"><button onClick={() => select((active + stories.length - 1) % stories.length)} aria-label="上一条焦点报道"><ArrowLeft size={19} /></button><button onClick={() => select((active + 1) % stories.length)} aria-label="下一条焦点报道"><ArrowRight size={19} /></button></div></div>
      <div className="issue-scene-caption"><span>{artwork[selected.slug] ? 'AI 原创视觉示意' : '本站原报道封面'}</span><span>历史内容样本 · 按原发布日期展示</span></div>
    </div>
  </section>
}

export default function DailyIssue() {
  const { view = 'daily' } = useParams()
  const [menu, setMenu] = useState(false)
  const [preview, setPreview] = useState(null)
  const [extraFocus, setExtraFocus] = useState(null)
  const [request, setRequest] = useState(null)
  const sceneEnd = useRef(null)
  const [paperHeader, setPaperHeader] = useState(false)
  const stories = useMemo(() => {
    const extra = posts.find((post) => post.slug === extraFocus)
    return extra ? [extra, ...defaultFocus.filter((post) => post.slug !== extra.slug)].slice(0, 3) : defaultFocus
  }, [extraFocus])
  const focus = (slug) => {
    setExtraFocus(defaultFocus.some((post) => post.slug === slug) ? null : slug)
    setRequest({ slug })
  }
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  useEffect(() => {
    if (!sceneEnd.current || typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(([entry]) => setPaperHeader(entry.boundingClientRect.top < 90), { rootMargin: '-90px 0px 0px 0px' })
    observer.observe(sceneEnd.current)
    return () => observer.disconnect()
  }, [])
  if (view !== 'daily') return <Navigate to={sectionLinks.find((item) => item.to === `/${view}`)?.to || '/daily'} replace />
  const navigation = sectionLinks.map((item) => <Link key={item.label} to={item.to} aria-current={item.label === '日报' ? 'page' : undefined}>{item.label}</Link>)
  return <div className="issue-demo" data-design="cinematic-03">
    <SeoMeta title="AI 日报 · 影像特刊 Demo" description="以真实报道为主角的日报视觉试稿，原创影像与滚动章节预览。" path="/demo/sections/daily" noindex />
    <header className={`issue-header${paperHeader ? ' issue-header--paper' : ''}`}><Link to="/" className="issue-brand" aria-label="AI 资讯观察首页"><strong>ai.</strong><span>AI 资讯观察<small>THE DAILY OBSERVER</small></span></Link><nav className="issue-desktop-nav" aria-label="Demo 主导航">{navigation}</nav><div className="issue-header-tools"><span className="issue-preview-label">日报视觉稿 / 03</span><button onClick={() => setMenu(!menu)} aria-label={menu ? '关闭栏目菜单' : '打开栏目菜单'} aria-expanded={menu} aria-controls="issue-mobile-nav">{menu ? <X size={23} /> : <Menu size={23} />}</button></div>{menu ? <nav id="issue-mobile-nav" aria-label="Demo 手机导航">{navigation}</nav> : null}</header>
    <main id="issue-content"><StoryReel stories={stories} request={request} onPreview={setPreview} /><div ref={sceneEnd} aria-hidden="true" style={{ height: 1 }} /><IssueNewsIndex posts={posts} onFocus={focus} /></main>
    <footer className="issue-footer"><div><Link to="/" className="issue-footer-brand">AI 资讯观察 <ArrowUpRight size={25} /></Link><p>沿着新闻，读回原始来源。</p></div><nav aria-label="阅读工具"><Link to="/daily">对照当前日报</Link><Link to="/archive">历史归档</Link><Link to="/feeds">订阅更新 ↗</Link></nav><span>独立 Demo / 原首页动态保留</span></footer>
    {preview ? <StoryDetails key={preview.slug} post={preview} onClose={() => setPreview(null)} /> : null}
  </div>
}
