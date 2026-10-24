import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowUpRight, Menu, X } from 'lucide-react'
import SeoMeta from '../../components/SeoMeta'
import DailyEdition from '../../components/news/daily/DailyEdition'
import { NEWS_NAV_ITEMS } from '../../utils/newsNavigation'
import data from './demoContent.json'

export { ArticleCover } from '../../components/news/daily/DailyEdition'

const posts = data.daily
const featuredPosts = [posts[0], posts[1], posts[4]]
const sectionLinks = NEWS_NAV_ITEMS.map((item) => item.to === '/daily' ? { ...item, to: '/demo/sections/daily' } : item)

function DemoHeader() {
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') setMenu(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  const navigation = sectionLinks.map((item) => <Link key={item.label} to={item.to} aria-current={item.label === '日报' ? 'page' : undefined}>{item.label}</Link>)
  return <header className="issue-header">
    <Link to="/" className="issue-brand" aria-label="AI 资讯观察首页"><strong>ai.</strong><span>AI 资讯观察<small>THE DAILY OBSERVER</small></span></Link>
    <nav className="issue-desktop-nav" aria-label="Demo 主导航">{navigation}</nav>
    <div className="issue-header-tools"><span className="issue-preview-label">日报视觉稿 / 03</span><button onClick={() => setMenu(!menu)} aria-label={menu ? '关闭栏目菜单' : '打开栏目菜单'} aria-expanded={menu} aria-controls="issue-mobile-nav">{menu ? <X size={23} /> : <Menu size={23} />}</button></div>
    {menu ? <nav id="issue-mobile-nav" aria-label="Demo 手机导航">{navigation}</nav> : null}
  </header>
}

function DemoFooter() {
  return <footer className="issue-footer"><div><Link to="/" className="issue-footer-brand">AI 资讯观察 <ArrowUpRight size={25} /></Link><p>沿着新闻，读回原始来源。</p></div><nav aria-label="阅读工具"><Link to="/daily">对照当前日报</Link><Link to="/archive">历史归档</Link><Link to="/feeds">订阅更新 ↗</Link></nav><span>独立 Demo / 原首页动态保留</span></footer>
}

export default function DailyIssue() {
  const { view = 'daily' } = useParams()
  if (view !== 'daily') return <Navigate to={sectionLinks.find((item) => item.to === `/${view}`)?.to || '/daily'} replace />
  return <>
    <SeoMeta title="AI 日报 · 影像特刊 Demo" description="以真实报道为主角的日报视觉试稿，报道封面与滚动章节预览。" path="/demo/sections/daily" noindex />
    <DailyEdition posts={posts} featuredPosts={featuredPosts} header={<DemoHeader />} footer={<DemoFooter />} className="issue-sample" note="内容为历史报道样本，日期沿用原发布日期。" caption="历史内容样本 · 按原发布日期展示" />
  </>
}
