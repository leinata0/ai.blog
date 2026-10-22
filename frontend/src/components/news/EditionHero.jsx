import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react'
import { formatDate } from '../../utils/date'
import useEditionScene from '../../hooks/useEditionScene'
import IntelligenceSculpture from './IntelligenceSculpture'
import { proxyImageUrl } from '../../utils/proxyImage'
import '../../styles/news-edition.css'
import '../../styles/news-signal-hero.css'

const CHAPTERS = [
  ['edition-focus', '本期焦点', '01'], ['edition-news', '新闻档案', '02'],
  ['edition-topics', '领域探索', '03'], ['edition-reading', '阅读与订阅', '04'],
]

function SignalNewsImage({ post }) {
  const [failed, setFailed] = useState(false)
  const source = proxyImageUrl(post.cover_image)
  return source && !failed ? <img src={source} width="1200" height="630" alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null
}

export default function EditionHero({ total, latestDate, loading, hasError, leadPost }) {
  const scene = useRef(null)
  const [paused, setPaused] = useState(false)
  useEditionScene(scene, paused)
  return <section ref={scene} className="edition-hero" aria-label="智能新纪元视觉专刊">
    <span className="edition-navigation-sentinel" aria-hidden="true" />
    <div className="edition-hero__stage" data-scene-paused={paused ? 'true' : undefined}>
      <div className="edition-hero__atmosphere" aria-hidden="true" />
      <div className="edition-hero__sculpture" aria-hidden="true"><IntelligenceSculpture sceneRef={scene} paused={paused} /></div>
      <div className="edition-hero__grain" aria-hidden="true" />
      <div className="edition-hero__masthead" aria-hidden="true">AI OBSERVER <span>/ SIGNAL STATION</span></div>
      <div className="edition-cover">
        <p className="edition-cover__eyebrow"><i aria-hidden="true" /> AI SIGNAL OBSERVATORY <span>人工智能观察站</span></p>
        <h1 aria-label="AI 新闻与观察"><span>捕捉 AI 的</span><span>下一个<b>信号。</b></span></h1>
        <p className="edition-cover__introduction">模型、产品、研究与产业。<br />从正在发生的变化，读到它的来源与背景。</p>
        <nav aria-label="本期阅读目录">{CHAPTERS.map(([id, title, number]) => <a href={`#${id}`} key={id}><i>{number}</i><span>{title}</span><ArrowUpRight size={13} aria-hidden="true" /></a>)}</nav>
        <div className="edition-cover__facts" role="group" aria-label="新闻档案状态">
          <span><b>{loading || hasError ? '—' : total.toLocaleString()}</b> 篇已发布</span>
          <span>本页最新发布 {!hasError && latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <b>{hasError ? '暂不可用' : loading ? '等待载入' : '暂无日期'}</b>}</span>
        </div>
        <a className="edition-cover__skip" href="#edition-focus">直接阅读新闻 <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div>
      <div className="edition-hero__instrument-label" aria-hidden="true"><span>01 — SIGNAL RECEIVER</span><b>把变化，连接起来。</b><i /></div>
      {leadPost && !hasError && !loading ? <Link className="edition-hero__latest" to={`/posts/${leadPost.slug}`}><span>最近发布 <ArrowUpRight size={14} aria-hidden="true" /></span><b>{leadPost.title}</b></Link> : null}
      <div className="edition-hero__statement" aria-hidden="true"><span>FROM SIGNAL TO CONTEXT</span><p>从一道信号，<br /><b>读到它的来处。</b></p><small>新闻 · 来源 · 背景</small></div>
      {leadPost && !hasError ? <div className="edition-hero__news-image" aria-hidden="true"><SignalNewsImage key={leadPost.slug} post={leadPost} /><div><span>IN FOCUS / 本期焦点</span><p>{leadPost.title}</p><small>继续下滑，阅读完整报道与来源</small></div></div> : null}
      <div className="edition-hero__light-wash" aria-hidden="true" />
      <button type="button" className="edition-hero__motion-toggle" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}{paused ? '继续场景动画' : '暂停场景动画'}</button>
      <div className="edition-hero__foot"><span>AI OBSERVER / NEWS, SOURCES & CONTEXT</span><a href="#edition-focus">滚动探索 <ArrowDown size={15} aria-hidden="true" /></a><small>原创交互场景 · 非新闻实拍</small></div>
    </div>
  </section>
}
