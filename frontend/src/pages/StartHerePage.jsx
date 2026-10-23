import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Rss } from 'lucide-react'

import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import BackToTop from '../components/BackToTop'
import SeoMeta from '../components/SeoMeta'
import { useSite } from '../contexts/SiteContext'
import {
  buildBreadcrumbJsonLd,
  buildCollectionPageJsonLd,
  buildWebSiteJsonLd,
} from '../utils/structuredData'
import { SITE_COPY, START_HERE_COPY } from '../utils/contentPresentation'
import '../styles/news-guide.css'
import '../styles/news-tech-reading.css'

const READING_ROUTES = [
  {
    number: '01',
    title: '头条与最新资讯',
    description: '从首页的大标题和资讯列表开始，先看发生了什么，再选择值得展开的消息。日期帮助你判断消息的新旧。',
    to: '/',
    label: '查看最新资讯',
    time: '快速浏览',
  },
  {
    number: '02',
    title: 'AI 日报',
    description: '按覆盖日期阅读模型、产品与行业动态。适合回看某一天的重点，或补上错过的几次更新。',
    to: '/daily',
    label: '阅读日报',
    time: '按日回看',
  },
  {
    number: '03',
    title: 'AI 周报',
    description: '把一周的变化放在一起看。需要更多背景时，再进入完整文章了解事件之间的联系与后续观察。',
    to: '/weekly',
    label: '阅读周报',
    time: '按周梳理',
  },
  {
    number: '04',
    title: '主题与系列',
    description: '围绕你关心的公司、模型、工具或研究继续阅读。主题聚合相关消息，系列提供连续的阅读线索。',
    to: '/topics',
    label: '浏览主题',
    secondary: { to: '/series', label: '浏览系列' },
    time: '持续追踪',
  },
  {
    number: '05',
    title: '历史归档与搜索',
    description: '按日期找回旧文章，或搜索一个具体名称。历史内容记录当时的信息，阅读时请留意适用时间与原始来源。',
    to: '/archive',
    label: '打开归档',
    secondary: { to: '/search', label: '搜索文章' },
    time: '查找背景',
  },
  {
    number: '06',
    title: '订阅后续更新',
    description: '把 RSS 加入阅读器，接收站内实际发布的内容。你也可以在订阅中心查看邮件和浏览器提醒选项。',
    to: '/feeds',
    label: '前往订阅中心',
    time: '有更新再读',
  },
]

export default function StartHerePage() {
  const { settings } = useSite()
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])

  const jsonLd = useMemo(() => ([
    buildWebSiteJsonLd({ siteUrl, name: SITE_COPY.brand, description: SITE_COPY.homeSubtitle }),
    buildCollectionPageJsonLd({
      siteUrl,
      name: '开始阅读',
      description: START_HERE_COPY.description,
      path: '/start-here',
    }),
    buildBreadcrumbJsonLd({
      siteUrl,
      items: [{ name: '首页', path: '/' }, { name: '开始阅读', path: '/start-here' }],
    }),
  ]), [siteUrl])

  return (
    <main className="news-guide">
      <SeoMeta
        title={`开始阅读 - ${SITE_COPY.brand}`}
        description={START_HERE_COPY.description}
        path="/start-here"
        jsonLd={jsonLd}
      />
      <Navbar />
      <div className="news-guide__body">
        <header className="news-guide__header">
          <div className="news-guide__edition"><span>阅读指南</span><span>READER’S GUIDE</span></div>
          <h1>{START_HERE_COPY.title}</h1>
          <p className="news-guide__intro">{START_HERE_COPY.description}</p>
          <div className="news-guide__header-links">
            <Link to="/">查看最新资讯 <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link to="/feeds"><Rss size={15} aria-hidden="true" /> 订阅更新</Link>
          </div>
        </header>

        <div className="news-guide__layout">
          <section aria-labelledby="reading-routes" className="news-guide__routes">
            <h2 id="reading-routes" className="news-guide__section-title">选择你的阅读方式</h2>
            {READING_ROUTES.map(({ number, title, description, to, label, secondary, time }) => (
              <article key={number} className="news-guide__route">
                <span className="news-guide__number" aria-hidden="true">{number}</span>
                <div>
                  <span className="news-guide__route-type">{time}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <div className="news-guide__route-links">
                    <Link to={to}>{label} <ArrowRight size={14} aria-hidden="true" /></Link>
                    {secondary ? <Link to={secondary.to}>{secondary.label} <ArrowRight size={14} aria-hidden="true" /></Link> : null}
                  </div>
                </div>
              </article>
            ))}
          </section>

          <aside className="news-guide__notes" aria-labelledby="reading-notes">
            <h2 id="reading-notes" className="news-guide__section-title">读一条消息，先看这三处</h2>
            <dl>
              <div><dt>发布日期</dt><dd>表示文章何时在本站发布。打开文章时，先确认它是近期更新还是历史记录。</dd></div>
              <div><dt>覆盖日期</dt><dd>表示日报或周报整理的时间范围。它可能早于文章的发布日。</dd></div>
              <div><dt>原始来源</dt><dd>沿正文引用和文末来源回到原文，核对具体事实、产品条件与研究结论。来源数量和规则评分供阅读参考。</dd></div>
            </dl>
            <div className="news-guide__notice">
              <h3>关于更新</h3>
              <p>首页展示站内已发布的资讯。日报、周报是内容栏目，实际更新以公开发布日期为准；自动化参与采集与整理。</p>
            </div>
            <Link className="news-guide__return" to="/">返回首页阅读 <ArrowRight size={16} aria-hidden="true" /></Link>
          </aside>
        </div>
      </div>
      <Footer />
      <BackToTop />
    </main>
  )
}
