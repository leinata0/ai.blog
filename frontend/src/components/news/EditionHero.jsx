import { useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react'
import { formatDate } from '../../utils/date'
import useEditionScene from '../../hooks/useEditionScene'
import IntelligenceSculpture from './IntelligenceSculpture'
import '../../styles/news-edition.css'
import '../../styles/news-renaissance-hero.css'

const CHAPTERS = [
  ['edition-focus', '本期焦点', 'I'], ['edition-news', '新闻档案', 'II'],
  ['edition-topics', '领域探索', 'III'], ['edition-reading', '阅读与订阅', 'IV'],
]

export default function EditionHero({ total, latestDate, loading, hasError }) {
  const scene = useRef(null)
  const [paused, setPaused] = useState(false)
  useEditionScene(scene, paused)
  return <section ref={scene} className="edition-hero" aria-label="智能新纪元视觉专刊">
    <span className="edition-navigation-sentinel" aria-hidden="true" />
    <div className="edition-hero__stage" data-scene-paused={paused ? 'true' : undefined}>
      <div className="edition-hero__sculpture" aria-hidden="true"><IntelligenceSculpture sceneRef={scene} paused={paused} /></div>
      <div className="edition-hero__shade" aria-hidden="true" />
      <div className="edition-hero__grain" aria-hidden="true" />
      <div className="edition-cover">
        <p className="edition-cover__eyebrow">THE AI OBSERVER <span>2026 / EDITION 01</span></p>
        <h1 aria-label="AI 新闻与观察"><span>智能</span><span>新纪元<span className="edition-cover__period">.</span></span></h1>
        <p className="edition-cover__english" aria-hidden="true">The Intelligence<br /><em>Edition.</em></p>
        <div className="edition-cover__bottom">
          <p className="edition-cover__introduction">记录人工智能，<br />与世界交汇的每一刻。</p>
          <nav aria-label="本期阅读目录">{CHAPTERS.map(([id, title, number]) => <a href={`#${id}`} key={id}><span>{title}</span><i>{number}</i></a>)}</nav>
          <div className="edition-cover__facts" role="group" aria-label="新闻档案状态">
            <span><b>{loading || hasError ? '—' : total.toLocaleString()}</b> 篇已发布</span>
            <span>本页最新发布 {!hasError && latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <b>{hasError ? '暂不可用' : loading ? '等待载入' : '暂无日期'}</b>}</span>
          </div>
        </div>
      </div>
      <div className="edition-hero__masthead" aria-hidden="true"><span>The Intelligence</span><em>Edition.</em></div>
      <div className="edition-hero__chapter" aria-hidden="true"><span>HUMAN CURIOSITY. MACHINE POSSIBILITY.</span><p>Intelligence<br /><em>in motion.</em></p><small>模型、产品、研究与产业。<br />从正在发生的变化，读到它的来源与背景。</small></div>
      <div className="edition-hero__light-wash" aria-hidden="true" />
      <button type="button" className="edition-hero__motion-toggle" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={11} aria-hidden="true" /> : <Pause size={11} aria-hidden="true" />}{paused ? '继续场景动画' : '暂停场景动画'}</button>
      <div className="edition-hero__foot"><span>HUMAN × INTELLIGENCE</span><a href="#edition-focus">直接阅读新闻 <ArrowUpRight size={13} aria-hidden="true" /></a><a href="#edition-focus" className="edition-hero__scroll">向下探索 <ArrowDown size={13} aria-hidden="true" /></a><small>原创交互场景 · 非新闻实拍</small></div>
    </div>
  </section>
}
