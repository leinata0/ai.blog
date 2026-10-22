import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatDate } from '../../utils/date'
import '../../styles/news-tech-intro.css'

// An editorial illustration, not a live telemetry or market data display.
function SignalLens() {
  return (
    <div className="signal-lens" aria-hidden="true">
      <svg viewBox="0 0 520 370" fill="none">
        <defs>
          <radialGradient id="signal-core"><stop stopColor="#d5ff78" stopOpacity=".6" /><stop offset="1" stopColor="#d5ff78" stopOpacity="0" /></radialGradient>
          <linearGradient id="signal-orbit"><stop stopColor="#c9ff6b" /><stop offset=".5" stopColor="#5fe8ef" /><stop offset="1" stopColor="#7971ff" /></linearGradient>
        </defs>
        <path className="signal-lens__guides" d="M40 185H480M260 25V345M86 61L434 309M86 309L434 61" />
        <g className="signal-lens__latitude">
          <ellipse cx="260" cy="185" rx="132" ry="132" />
          <ellipse cx="260" cy="185" rx="132" ry="46" />
          <ellipse cx="260" cy="185" rx="66" ry="132" />
          <path d="M144 122H376M144 248H376" />
        </g>
        <g className="signal-lens__outer">
          <circle cx="260" cy="185" r="160" strokeDasharray="1 9" />
          <circle cx="260" cy="185" r="172" strokeDasharray="100 32 4 35 180 190" />
        </g>
        <g className="signal-lens__orbit">
          <ellipse cx="260" cy="185" rx="220" ry="70" transform="rotate(-29 260 185)" stroke="url(#signal-orbit)" />
          <ellipse cx="260" cy="185" rx="185" ry="101" transform="rotate(38 260 185)" />
          <circle cx="452" cy="76" r="5" fill="#d5ff78" stroke="none" />
          <circle cx="82" cy="128" r="4" fill="#9690ff" stroke="none" />
        </g>
        <circle cx="260" cy="185" r="90" fill="url(#signal-core)" stroke="none" />
        <g className="signal-lens__scan"><path d="M260 185L260 53A132 132 0 0 1 371 113Z" fill="#a5ffe4" fillOpacity=".055" /><path d="M260 185V53" stroke="#a5ffe4" strokeOpacity=".5" /></g>
        <circle cx="260" cy="185" r="5" fill="#e4ff9b" />
        <path d="M248 185H272M260 173V197" stroke="#d5ff78" />
        <path className="signal-lens__callouts" d="M373 111L413 60H482M148 266L102 313H33M354 278L393 316H478" />
        <g className="signal-lens__labels" fill="#9daab5" stroke="none"><text x="416" y="50">RESEARCH</text><text x="33" y="330">OPEN SOURCE</text><text x="399" y="332">INDUSTRY</text><text x="247" y="30">AI</text></g>
      </svg>
      <span className="signal-lens__caption">THE SIGNAL / BEYOND THE NOISE</span>
    </div>
  )
}

export default function TechNewsIntro({ total, latestDate, loading, hasError = false, compact = false }) {
  const frame = useRef(null)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  function followPointer(event) {
    if (event.pointerType === 'touch' || frame.current) return
    const target = event.currentTarget
    const bounds = target.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / bounds.width
    const y = (event.clientY - bounds.top) / bounds.height
    frame.current = requestAnimationFrame(() => {
      target.style.setProperty('--pointer-x', `${x * 100}%`)
      target.style.setProperty('--pointer-y', `${y * 100}%`)
      target.style.setProperty('--lens-x', `${(x - .5) * 8}px`)
      target.style.setProperty('--lens-y', `${(y - .5) * 8}px`)
      frame.current = null
    })
  }

  function resetPointer(event) {
    cancelAnimationFrame(frame.current)
    frame.current = null
    const target = event.currentTarget
    for (const key of ['--pointer-x', '--pointer-y', '--lens-x', '--lens-y']) target.style.removeProperty(key)
  }

  return (
    <header className={`tech-intro${compact ? ' tech-intro--compact' : ''}`} onPointerMove={followPointer} onPointerLeave={resetPointer}>
      <div className="tech-intro__eyebrow"><span><i /> INDEPENDENT AI NEWS</span><span>技术 / 产品 / 产业</span></div>
      <div className="tech-intro__copy">
        <div className="tech-intro__wordmark" aria-hidden="true">AI<span>SIGNAL<sup>↗</sup></span></div>
        <h1>AI 新闻与观察</h1>
        <p>穿透噪声，追踪技术的下一步。</p>
        <div className="tech-intro__actions"><a href="#news-feed-title">进入新闻流 <ArrowDownRight size={17} /></a><Link to="/topics">探索主题 <ArrowUpRight size={16} /></Link></div>
      </div>
      {!compact ? <SignalLens /> : null}
      <div className="tech-intro__index" role="group" aria-label="新闻档案状态">
        <span className="tech-intro__index-label">THE NEWS INDEX <i /></span>
        <span><b>{loading || hasError ? '—' : total.toLocaleString()}</b><small>篇已发布</small></span>
        <span><small>本页最新发布</small>{!hasError && latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <b className="tech-intro__pending">{hasError ? '暂不可用' : loading ? '等待载入' : '暂无日期'}</b>}</span>
        <Link to="/archive">打开新闻档案 <ArrowUpRight size={15} /></Link>
      </div>
    </header>
  )
}
