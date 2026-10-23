import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Rss, Route } from 'lucide-react'
import TechPageFrame from '../TechPageFrame'
import { START_HERE_COPY } from '../../utils/contentPresentation'
import '../../styles/tech-reading-guide.css'

const NOTES = [
  ['发布日期', '表示文章何时在本站发布。打开文章时，先确认它是近期更新还是历史记录。'],
  ['覆盖日期', '表示日报或周报整理的时间范围。它可能早于文章的发布日。'],
  ['原始来源', '沿正文引用和文末来源回到原文，核对具体事实、产品条件与研究结论。来源数量和规则评分供阅读参考。'],
]

export default function TechReadingGuide({ routes }) {
  const [selected, setSelected] = useState(0)
  const current = routes[selected]
  const visual = <div className="tech-guide-navigator">
    <div className="tech-guide-navigator__bar"><span>READING PATH / {current.number}</span><Route size={16} aria-hidden="true" /></div>
    <div className="tech-guide-navigator__map" aria-hidden="true">{routes.map((route, index) => <span key={route.number} className={selected === index ? 'is-selected' : ''}>{route.number}</span>)}</div>
    <div className="tech-guide-navigator__selection" aria-live="polite"><small>{current.time}</small><h2>{current.title}</h2><p>{current.description}</p><Link to={current.to}>进入这条路径 <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
    <span className="tech-guide-navigator__edge" aria-hidden="true">READ / CONNECT / UNDERSTAND</span>
  </div>

  return <TechPageFrame section="reading" index="05 / READING PATHS" title={START_HERE_COPY.title} accentTitle="从信息，走向理解。" description={START_HERE_COPY.description}
    meta={<span>选择一种节奏，找到你的阅读入口。</span>}
    actions={<><Link to="/">查看最新资讯 <ArrowRight size={16} aria-hidden="true" /></Link><Link to="/feeds"><Rss size={15} aria-hidden="true" /> 订阅更新</Link></>}
    visual={visual}>
    <section className="tech-guide-routes" aria-labelledby="reading-routes">
      <header className="tech-guide-section-head"><div><span>FIND YOUR WAY</span><h2 id="reading-routes">选择你的阅读方式</h2></div><p>按下一个入口，预览它能带你去哪里。</p></header>
      <div className="tech-guide-route-switch" role="group" aria-label="选择阅读路径">{routes.map((route, index) => <button type="button" key={route.number} aria-pressed={selected === index} onClick={() => setSelected(index)}><span>{route.number}</span>{route.time}<ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>
      <div className="tech-guide-route-grid">{routes.map((route, index) => <article key={route.number} className={`tech-guide-route${selected === index ? ' is-selected' : ''}`} data-tech-reveal>
        <div className="tech-guide-route__index"><span>{route.number}</span><small>{route.time}</small></div>
        <h3>{route.title}</h3><p>{route.description}</p><div className="tech-guide-route__links"><Link to={route.to}>{route.label} <ArrowUpRight size={16} aria-hidden="true" /></Link>{route.secondary ? <Link to={route.secondary.to}>{route.secondary.label} <ArrowRight size={14} aria-hidden="true" /></Link> : null}</div>
      </article>)}</div>
    </section>
    <aside className="tech-guide-notes" aria-labelledby="reading-notes" data-tech-reveal>
      <header><span>BEFORE YOU READ</span><h2 id="reading-notes">读一条消息，<br />先看这三处。</h2></header>
      <dl>{NOTES.map(([title, description], index) => <div key={title}><span aria-hidden="true">0{index + 1}</span><dt>{title}</dt><dd>{description}</dd></div>)}</dl>
      <p className="tech-guide-notice">首页展示站内已发布的资讯。日报、周报是内容栏目，实际更新以公开发布日期为准；自动化参与采集与整理。</p>
    </aside>
  </TechPageFrame>
}
