import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Menu, Pause, Play, X } from 'lucide-react'
import SeoMeta from '../../components/SeoMeta'
import { proxyImageUrl } from '../../utils/proxyImage'
import { formatDate } from '../../utils/date'
import { getSeriesTitle, getSeriesDescription } from '../../utils/contentPresentation'
import GallerySculpture from './GallerySculpture'
import GalleryIndex from './GalleryIndex'
import data from './demoContent.json'
import './gallery.css'

const sections = [
  { view: 'daily', label: '日报', code: '01', word: 'SIGNALS', title: ['看见变化，', '然后向前。'], intro: '选择一条新闻，换一个角度看变化。' },
  { view: 'weekly', label: '周报', code: '02', word: 'PERSPECTIVE', title: ['把一周，', '放进全景。'], intro: '拉开一点距离，看消息如何连成趋势。' },
  { view: 'topics', label: '主题', code: '03', word: 'CONNECTIONS', title: ['沿着线索，', '进入下一层。'], intro: '一个主题，一组持续发展的观察。' },
  { view: 'series', label: '系列', code: '04', word: 'COLLECTIONS', title: ['一个问题，', '多一种视角。'], intro: '将分散的篇目，放回同一条思考路径。' },
  { view: 'start-here', label: '开始阅读', code: '05', word: 'CURIOSITY', title: ['从好奇，', '走向理解。'], intro: '没有固定路线。从你想知道的事开始。' },
]

const articleEntry = (post) => ({ id: post.slug, title: post.title, image: post.cover_image, date: post.created_at, summary: post.summary, sources: post.source_count, url: `/posts/${encodeURIComponent(post.slug)}` })
function entriesFor(view) {
  if (view === 'daily' || view === 'weekly') return data[view].map(articleEntry)
  if (view === 'topics') return data.topics.map((topic) => ({ id: topic.topic_key, title: topic.display_title, image: topic.latest_posts?.find((post) => post.cover_image)?.cover_image, summary: topic.description, date: topic.latest_post_at, count: topic.post_count, posts: topic.latest_posts, url: `/topics/${encodeURIComponent(topic.topic_key)}` }))
  if (view === 'series') return data.series.map((series) => ({ id: series.slug, title: getSeriesTitle(series), image: series.cover_image, summary: getSeriesDescription(series), date: series.latest_post_at, count: series.post_count, posts: series.latest_posts, url: `/series/${encodeURIComponent(series.slug)}` }))
  return [
    { id: 'daily-path', title: '跟上新变化', summary: '从日报出发，沿时间寻找模型、产品和行业里的新线索。', image: data.daily[0]?.cover_image, url: '/demo/sections/daily' },
    { id: 'weekly-path', title: '看见更大的图景', summary: '打开周报，慢一点，把分散的消息放回背景。', image: data.weekly[0]?.cover_image, url: '/demo/sections/weekly' },
    { id: 'topic-path', title: '追踪一个具体问题', summary: '进入主题与系列，沿着一个问题接着读下去。', image: data.topics[0]?.latest_posts?.[0]?.cover_image, url: '/demo/sections/topics' },
  ]
}

function Cover({ entry }) {
  const src = proxyImageUrl(entry.image)
  const [failed, setFailed] = useState('')
  return src && failed !== src ? <img src={src} alt="" width="900" height="600" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} /> : <div className="gx-cover-fallback"><span>AI / OBSERVER</span><strong>{entry.title}</strong></div>
}

function DetailDialog({ entry, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog className="gx-dialog" ref={ref} aria-labelledby="gx-dialog-title" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <button className="gx-dialog-close" onClick={onClose} aria-label="关闭线索详情" autoFocus><X size={23} /></button>
    <div className="gx-dialog-image"><Cover entry={entry} /></div>
    <div className="gx-dialog-copy"><span className="gx-mono">A CLOSER LOOK / 线索详情</span><h2 id="gx-dialog-title">{entry.title}</h2><EntryMeta entry={entry} />{entry.summary ? <p>{entry.summary}</p> : null}{entry.count === 0 ? <p>这个系列尚未收录文章，可以先查看系列介绍。</p> : null}<Link to={entry.url} className="gx-solid-link">{entry.posts ? '进入内容档案' : '打开完整内容'}<ArrowUpRight size={18} /></Link></div>
  </dialog>
}

function EntryMeta({ entry }) {
  return <div className="gx-entry-meta">{entry.date ? <time dateTime={entry.date}>{formatDate(entry.date)}</time> : null}{Number(entry.sources) > 0 ? <span>{entry.sources} 个原始来源</span> : null}{typeof entry.count === 'number' ? <span>{entry.count} 篇收录</span> : null}</div>
}

function GalleryRoom({ section, entries }) {
  const [activeId, setActiveId] = useState(entries[0]?.id)
  const [paused, setPaused] = useState(false)
  const [detail, setDetail] = useState(null)
  const stage = useRef(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: stage, offset: ['start start', 'end start'] })
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -120])
  const coverY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -55])
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateY = useSpring(x, { stiffness: 80, damping: 22 })
  const rotateX = useSpring(y, { stiffness: 80, damping: 22 })
  const activeIndex = Math.max(0, entries.findIndex((entry) => entry.id === activeId))
  const entry = entries[activeIndex]
  const move = (step) => setActiveId(entries[(activeIndex + step + entries.length) % entries.length].id)
  const select = (id) => {
    setActiveId(id)
    stage.current?.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' })
  }
  const pointer = (event) => {
    if (paused || reduce || event.pointerType !== 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    x.set(((event.clientX - rect.left) / rect.width - .5) * 12)
    y.set(-((event.clientY - rect.top) / rect.height - .5) * 9)
  }
  return <>
    <section ref={stage} className={`gx-stage gx-stage--${section.view}${paused || detail ? ' gx-stage--paused' : ''}`} aria-label={`${section.label}交互展台`} onPointerMove={pointer} onPointerLeave={() => { x.set(0); y.set(0) }}>
      <div className="gx-stage-coordinate gx-mono"><span>FEATURE {section.code} / {section.label}</span><span>MOVE THROUGH IDEAS ↗</span></div>
      <div className="gx-stage-heading"><p className="gx-kicker"><span />AI OBSERVER / THE INTERACTIVE EDITION</p><h1>{section.title.map((line) => <span key={line}>{line}</span>)}</h1><p>{section.intro}</p><a href="#gx-explore" className="gx-explore-link">探索内容<ArrowDown size={17} /></a></div>
      <span className="gx-stage-word" aria-hidden="true">{section.word}</span>
      <motion.div className="gx-art" aria-hidden="true" style={{ y: sceneY }}><GallerySculpture image={entry?.image} mode={section.view} paused={paused || Boolean(detail)} /><div className="gx-art-floor" /></motion.div>
      {entry ? <motion.div className="gx-cover-position" style={reduce ? undefined : { rotateY, rotateX, y: coverY }}><div className="gx-cover-float"><AnimatePresence mode="wait" initial={false}><motion.button className="gx-cover-board" key={entry.id} onClick={() => setDetail(entry)} aria-label={`查看线索：${entry.title}`} initial={{ opacity: 0, y: reduce ? 0 : 28, rotateZ: reduce ? 0 : 4 }} animate={{ opacity: 1, y: 0, rotateZ: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -24 }} transition={{ duration: reduce ? 0 : .32 }}><div className="gx-board-top"><span>CONTENT SPECIMEN</span><span>{String(activeIndex + 1).padStart(2, '0')} ↗</span></div><div className="gx-board-image"><Cover entry={entry} /></div><div className="gx-board-bottom"><span>{section.label} / 内容标本</span><ArrowUpRight size={16} /></div></motion.button></AnimatePresence></div></motion.div> : null}
      <div className="gx-orbit-label gx-mono" aria-hidden="true"><span className="gx-label-line" />IDEAS IN ORBIT</div>
      <div className="gx-selected-story" aria-live="polite"><span className="gx-mono">ON DISPLAY / 当前展出</span><AnimatePresence mode="wait" initial={false}><motion.div key={entry?.id} initial={{ opacity: 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -10 }} transition={{ duration: reduce ? 0 : .2 }}><h2>{entry?.title}</h2>{entry ? <EntryMeta entry={entry} /> : null}</motion.div></AnimatePresence><button onClick={() => setDetail(entry)} className="gx-detail-link">展开线索 <ArrowUpRight size={18} /></button></div>
      <div className="gx-stage-controls"><div className="gx-pagination"><button onClick={() => move(-1)} aria-label="上一条线索"><ArrowLeft size={21} /></button><span><strong>{String(activeIndex + 1).padStart(2, '0')}</strong><i />{String(entries.length).padStart(2, '0')}</span><button onClick={() => move(1)} aria-label="下一条线索"><ArrowRight size={21} /></button></div><button className="gx-motion-control" onClick={() => { setPaused(!paused); x.set(0); y.set(0) }} aria-pressed={paused} aria-label={paused ? '继续场景动态' : '暂停场景动态'}>{paused ? <Play size={13} /> : <Pause size={13} />}<span>{paused ? '继续动态' : '暂停动态'}</span></button></div>
      <div className="gx-stage-bottom gx-mono"><span>SCROLL TO EXPLORE <ArrowDown size={11} /></span><span>真实历史内容样本 · 原发布日期保留</span></div>
    </section>
    {section.view === 'daily' || section.view === 'weekly' ? <nav className="gx-chapter-bar" aria-label="特刊焦点章节">{entries.slice(0, 3).map((item, index) => <button key={item.id} onClick={() => select(item.id)} aria-pressed={entry?.id === item.id} aria-label={`选择章节：${item.title}`}><span className="gx-mono">CHAPTER {String(index + 1).padStart(2, '0')}<ArrowUpRight size={15} /></span><strong>{item.title}</strong><time dateTime={item.date}>{formatDate(item.date)}</time></button>)}</nav> : null}
    <div className="gx-crossing" aria-hidden="true"><span>LESS NOISE.</span><span className="gx-crossing-symbol">✳</span><span>MORE PERSPECTIVE.</span><ArrowUpRight /></div>
    <GalleryIndex view={section.view} entries={entries} activeId={entry?.id} onSelect={select} />
    {detail ? <DetailDialog key={detail.id} entry={detail} onClose={() => setDetail(null)} /> : null}
  </>
}

export default function SectionUiDemo() {
  const { view: requested = 'daily' } = useParams()
  const section = sections.find((item) => item.view === requested) || sections[0]
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    setMenu(false)
    const escape = (event) => { if (event.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [section.view])
  const nav = <><Link to="/">首页 <ArrowUpRight size={11} aria-hidden="true" /></Link>{sections.map((item) => <Link key={item.view} to={`/demo/sections/${item.view}`} aria-label={item.label} aria-current={item.view === section.view ? 'page' : undefined}><small>{item.code}</small>{item.label}</Link>)}</>
  return <div className="gx-demo">
    <SeoMeta title={`${section.label} · 沉浸式特刊 Demo`} description="AI 资讯观察沉浸式科技特刊独立预览，使用真实历史内容。" path={`/demo/sections/${section.view}`} noindex />
    <div className="gx-preview-strip"><span>DESIGN EXPERIMENT / 02 · 沉浸式科技特刊</span><Link to={`/${section.view}`}>对照当前版本 <ArrowUpRight size={12} /></Link></div>
    <header className="gx-header"><Link to="/" className="gx-brand" aria-label="AI 资讯观察首页"><strong>ai<span>↗</span></strong><span>OBSERVER<small>IDEAS WORTH EXPLORING</small></span></Link><nav aria-label="Demo 主导航" className="gx-desktop-nav">{nav}</nav><div className="gx-header-end"><span className="gx-edition">A DIFFERENT<br />POINT OF VIEW.</span><button className="gx-menu" onClick={() => setMenu(!menu)} aria-label={menu ? '关闭栏目菜单' : '打开栏目菜单'} aria-expanded={menu} aria-controls="gx-mobile-nav">{menu ? <X size={23} /> : <Menu size={23} />}</button></div>{menu ? <nav id="gx-mobile-nav" className="gx-mobile-nav" aria-label="Demo 手机导航">{nav}</nav> : null}</header>
    <main id="gx-demo-content"><GalleryRoom key={section.view} section={section} entries={entriesFor(section.view)} /></main>
    <footer className="gx-footer"><Link to="/" className="gx-footer-statement">保持好奇。<br /><span>继续看见。</span><ArrowUpRight /></Link><div><span className="gx-mono">AI OBSERVER / 独立栏目 DEMO</span><p>使用站内真实历史文章与对应封面。<br />首页沿用现有动态效果。</p><nav aria-label="阅读工具"><Link to="/archive">历史归档</Link><Link to="/search">搜索</Link><Link to="/feeds">订阅更新 ↗</Link></nav></div></footer>
  </div>
}
