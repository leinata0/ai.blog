import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, ArrowUpRight, Rss } from 'lucide-react'
import { START_HERE_COPY } from '../../utils/contentPresentation'
import '../../styles/cinematic-reading-guide.css'

const NOTES = [
  ['发布日期', '表示文章何时在本站发布。打开文章时，先确认它是近期更新还是历史记录。'],
  ['覆盖日期', '表示日报或周报整理的时间范围。它可能早于文章的发布日。'],
  ['原始来源', '沿正文引用和文末来源回到原文，核对具体事实、产品条件与研究结论。来源数量和规则评分供阅读参考。'],
]

export default function TechReadingGuide({ routes }) {
  const [selected, setSelected] = useState(0)
  const reduce = useReducedMotion()
  const current = routes[selected]
  const reveal = !reduce && typeof IntersectionObserver !== 'undefined'
  return <div className="cinema-layout cinema-guide" data-tech-page="reading">
    <header className="cinema-hero cinema-guide-hero">
      <div className="cinema-guide-lines" aria-hidden="true">{routes.map((route, index) => <motion.div key={route.number} animate={{ opacity:selected === index ? 1 : .17, x:selected === index ? 0 : 24 }} transition={{ duration:reduce ? 0 : .55 }}><span>{route.number}</span><i /></motion.div>)}</div>
      <div className="cinema-guide-intro"><span className="cinema-kicker">05 / FIND YOUR READING ORBIT</span><h1>{START_HERE_COPY.title}</h1><p>{START_HERE_COPY.description}</p><a href="#reading-routes" className="cinema-guide-explore">探索阅读路径 <ArrowDown size={18} /></a></div>
      <div className="cinema-guide-console">
        <div className="cinema-guide-console-head"><span>READING SELECTOR</span><span>{current.number} / 06</span></div>
        <div className="cinema-guide-choices" role="group" aria-label="选择阅读路径">{routes.map((route, index) => <button type="button" key={route.number} aria-pressed={selected === index} onClick={() => setSelected(index)}><span>{route.number}</span><b>{route.time}</b><ArrowUpRight size={17} aria-hidden="true" /></button>)}</div>
        <motion.div key={current.number} className="cinema-guide-preview" aria-live="polite" initial={reduce ? false : { opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ duration:reduce ? 0 : .3 }}>
          <span className="cinema-guide-preview-no" aria-hidden="true">{current.number}</span><div><small>YOUR NEXT STOP</small><h2>{current.title}</h2><p>{current.description}</p><Link to={current.to} className="cinema-button">进入这条路径 <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
        </motion.div>
      </div>
      <div className="cinema-guide-bottom"><span>CHOOSE YOUR PACE. FOLLOW YOUR CURIOSITY.</span><Link to="/feeds"><Rss size={14} /> 订阅更新</Link></div>
    </header>
    <section className="cinema-body cinema-guide-directory" aria-labelledby="reading-routes">
      <header className="cinema-section-heading"><div><span className="cinema-kicker">THE ROUTE DIRECTORY</span><h2 id="reading-routes">选择你的阅读方式</h2></div><p>从快速浏览到持续追踪，入口始终在这里。<br />按你的节奏，往下读。</p></header>
      <div className="cinema-guide-route-grid">{routes.map((route, index) => <motion.article key={route.number} className={selected === index ? 'is-selected' : ''} initial={reveal ? { opacity:0, y:16 } : false} whileInView={reveal ? { opacity:1, y:0 } : undefined} viewport={{ once:true, amount:.1 }} transition={{ duration:reduce ? 0 : .4 }}><div className="cinema-guide-route-top"><span>{route.number}</span><small>{route.time}</small></div><h3>{route.title}</h3><p>{route.description}</p><div className="cinema-guide-route-links"><Link to={route.to}>{route.label} <ArrowUpRight size={17} /></Link>{route.secondary ? <Link to={route.secondary.to}>{route.secondary.label} <ArrowRight size={14} /></Link> : null}</div></motion.article>)}</div>
    </section>
    <aside className="cinema-guide-notes" aria-labelledby="reading-notes"><div><span className="cinema-kicker">BEFORE YOU READ</span><h2 id="reading-notes">看见消息，<br />也看清来处。</h2></div><dl>{NOTES.map(([title, description], index) => <div key={title}><span aria-hidden="true">0{index + 1}</span><dt>{title}</dt><dd>{description}</dd></div>)}</dl><p>首页展示站内已发布的资讯。日报、周报是内容栏目，实际更新以公开发布日期为准；自动化参与采集与整理。</p></aside>
  </div>
}
