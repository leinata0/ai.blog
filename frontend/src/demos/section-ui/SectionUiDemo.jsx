import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowUpRight, ArrowRight, Menu, Search, X } from 'lucide-react'
import SeoMeta from '../../components/SeoMeta'
import { DailyDemo, WeeklyDemo } from './DemoEditions'
import { TopicsDemo, SeriesDemo, ReadingDemo } from './DemoCollections'
import data from './demoContent.json'
import './section-ui.css'

const sections = [
  { view: 'daily', label: '日报', english: 'Daily' },
  { view: 'weekly', label: '周报', english: 'Weekly' },
  { view: 'topics', label: '主题', english: 'Topics' },
  { view: 'series', label: '系列', english: 'Collections' },
  { view: 'start-here', label: '开始阅读', english: 'Start here' },
]

export default function SectionUiDemo() {
  const { view: requested = 'daily' } = useParams()
  const section = sections.find((item) => item.view === requested) || sections[0]
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    setMenu(false)
    const onEscape = (event) => { if (event.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [section.view])
  const nav = <><Link to="/" className="su-home-link">首页 <ArrowUpRight size={11} aria-hidden="true" /></Link>{sections.map((item) => <Link key={item.view} to={`/demo/sections/${item.view}`} aria-current={item.view === section.view ? 'page' : undefined}>{item.label}</Link>)}</>
  return <div className="su-demo">
    <SeoMeta title={`${section.label} · 栏目视觉预览`} description="AI 资讯观察栏目视觉预览，使用真实历史内容样本。" path={`/demo/sections/${section.view}`} noindex />
    <div className="su-preview-strip"><div><span>DESIGN PREVIEW</span><span>栏目视觉预览 · 历史内容样本</span></div><Link to={section.view === 'start-here' ? '/start-here' : `/${section.view}`}>对照当前版本 <ArrowUpRight size={12} /></Link></div>
    <header className="su-header"><div className="su-header-inner"><Link to="/" className="su-brand" aria-label="AI 资讯观察首页"><span className="su-brand-symbol">ai<span>.</span></span><span>OBSERVER<small>人工智能新闻与观察</small></span></Link><nav className="su-main-nav" aria-label="Demo 主导航">{nav}</nav><div className="su-header-tools"><Link to="/search" className="su-header-search"><Search size={18} aria-hidden="true" /><span>搜索</span></Link><Link to="/feeds" className="su-subscribe">订阅更新 <ArrowUpRight size={14} /></Link><button className="su-menu-button" onClick={() => setMenu(!menu)} aria-label={menu ? '关闭栏目菜单' : '打开栏目菜单'} aria-expanded={menu} aria-controls="su-mobile-nav">{menu ? <X size={21} /> : <Menu size={21} />}</button></div></div>{menu ? <nav className="su-mobile-nav" id="su-mobile-nav" aria-label="Demo 手机导航">{nav}</nav> : null}</header>
    <main id="main-content" className="su-main" key={section.view}>
      {section.view === 'daily' ? <DailyDemo data={data} /> : section.view === 'weekly' ? <WeeklyDemo data={data} /> : section.view === 'topics' ? <TopicsDemo data={data} /> : section.view === 'series' ? <SeriesDemo data={data} /> : <ReadingDemo data={data} />}
    </main>
    <section className="su-bottom-invitation"><div><span className="su-eyebrow">STAY CURIOUS. STAY INFORMED.</span><h2>重要的变化，值得继续追踪。</h2></div><Link to="/feeds" className="su-button su-button--dark">选择订阅方式 <ArrowRight size={18} /></Link></section>
    <footer className="su-footer"><div><strong>AI OBSERVER<span>读原始来源，保留独立判断。</span></strong><div><Link to="/">首页</Link><Link to="/archive">历史归档</Link><Link to="/feeds">RSS 与订阅</Link></div></div><p>本次预览使用站内真实历史内容，展示日期为原发布日期。首页沿用现有动态效果。</p></footer>
  </div>
}
