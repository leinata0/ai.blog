import { useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react'
import { formatDate } from '../../utils/date'
import useEditionScene from '../../hooks/useEditionScene'
import IntelligenceSculpture from './IntelligenceSculpture'
import '../../styles/news-edition.css'

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
    <div className="edition-hero__backdrop" aria-hidden="true"><img src="/images/intelligence-edition/garden-environment-v2.jpg" width="1672" height="941" alt="" fetchpriority="high" loading="eager" /></div>
    <div className="edition-hero__veil" aria-hidden="true" />
    <div className="edition-hero__hand edition-hero__hand--left" aria-hidden="true"><img src="/images/intelligence-edition/marble-hands.png" width="2172" height="724" alt="" /></div>
    <div className="edition-hero__hand edition-hero__hand--right" aria-hidden="true"><img src="/images/intelligence-edition/marble-hands.png" width="2172" height="724" alt="" /></div>
    <div className="edition-hero__sculpture" aria-hidden="true"><IntelligenceSculpture sceneRef={scene} paused={paused} /></div>
    <div className="edition-hero__ornament" aria-hidden="true"><img src="/images/intelligence-edition/floating-ribbon.png" width="1536" height="1024" alt="" fetchpriority="low" loading="lazy" /></div>
    <div className="edition-hero__paper edition-hero__paper--one" aria-hidden="true"><i /><i /><i /></div>
    <div className="edition-hero__paper edition-hero__paper--two" aria-hidden="true"><i /><i /></div>
    <div className="edition-hero__masthead" aria-hidden="true">The <em>Intelligence</em> Edition</div>
    <div className="edition-cover">
      <p className="edition-cover__eyebrow">AI OBSERVER / EDITIONS</p>
      <h1 aria-label="AI 新闻与观察"><span>The</span><em>Intelligence</em><span>Edition</span></h1>
      <div className="edition-cover__introduction"><p>智能，正在打开<br />世界的另一种可能。</p><span>AI 新闻与观察 · 智能新纪元</span></div>
      <nav aria-label="本期阅读目录">{CHAPTERS.map(([id, title, number]) => <a href={`#${id}`} key={id}><span>{title}</span><i>{number}</i></a>)}</nav>
      <div className="edition-cover__facts" role="group" aria-label="新闻档案状态">
        <span><b>{loading || hasError ? '—' : total.toLocaleString()}</b> 篇已发布</span>
        <span>本页最新发布 {!hasError && latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <b>{hasError ? '暂不可用' : loading ? '等待载入' : '暂无日期'}</b>}</span>
      </div>
      <a className="edition-cover__skip" href="#edition-focus">直接阅读新闻 <ArrowUpRight size={15} aria-hidden="true" /></a>
    </div>
    <div className="edition-hero__statement" aria-hidden="true"><span>THE WORLD IN MOTION</span><p>从变化中，<br /><em>看见下一步。</em></p></div>
    <div className="edition-hero__paper-wipe" aria-hidden="true" />
    <button type="button" className="edition-hero__motion-toggle" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{paused ? '继续场景动画' : '暂停场景动画'}</button>
    <div className="edition-hero__foot"><span>人类的好奇心，通向智能的新图景。</span><a href="#edition-focus">SCROLL TO EXPLORE <ArrowDown size={15} aria-hidden="true" /></a><small>原创视觉插画 · 非新闻照片</small></div>
    </div>
  </section>
}
