import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Rss } from 'lucide-react'

export default function NewsReadingRail() {
  return <aside className="news-reading-rail" aria-label="栏目与订阅">
    <section className="news-newsletter">
      <Rss size={24} strokeWidth={1.5} aria-hidden="true" /><span>THE READING LIST</span>
      <h2>重要的变化，<br />值得再读一次。</h2><p>通过 RSS、邮件或浏览器提醒，接收后续发布的内容。</p>
      <Link to="/feeds">选择订阅方式 <ArrowUpRight size={16} aria-hidden="true" /></Link>
    </section>
    <section className="news-channel-index">
      <div className="news-section-label"><h2>按你的节奏阅读</h2><span>SECTIONS</span></div>
      <Link to="/daily"><span><b>AI 日报</b><small>按覆盖日期梳理重要事件</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
      <Link to="/weekly"><span><b>AI 周报</b><small>从一周变化回看产业脉络</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
      <Link to="/series"><span><b>专题与系列</b><small>围绕同一条线索继续深入</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
      <Link to="/archive"><span><b>历史归档</b><small>沿时间线查找过往报道</small></span><ArrowUpRight size={18} aria-hidden="true" /></Link>
    </section>
    <section className="news-editor-note"><span className="news-kicker">阅读提示</span><p>新闻有它的时间。查看发布日期与原始来源，区分当时的事实和后续的变化。</p><Link to="/start-here">了解这份阅读指南 <ArrowRight size={13} aria-hidden="true" /></Link></section>
  </aside>
}
