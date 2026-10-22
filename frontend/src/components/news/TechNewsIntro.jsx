import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { formatDate } from '../../utils/date'
import '../../styles/news-tech-intro.css'

export default function TechNewsIntro({ total, latestDate, loading, hasError = false, compact = false }) {
  return (
    <header className={`tech-intro${compact ? ' tech-intro--compact' : ''}`}>
      <div className="tech-intro__copy">
        <p className="tech-intro__eyebrow"><span /> THE AI OBSERVER <b>TECHNOLOGY, IN CONTEXT.</b></p>
        <h1>AI 新闻与观察<span aria-hidden="true">↗</span></h1>
        <p className="tech-intro__description">关注正在发生的技术变化，也看见新闻背后的脉络。</p>
      </div>
      <div className="tech-intro__index" role="group" aria-label="新闻档案状态">
        <span><b>{loading || hasError ? '—' : total.toLocaleString()}</b><small>篇已发布</small></span>
        <span><small>本页最新发布</small>{!hasError && latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <b className="tech-intro__pending">{hasError ? '暂不可用' : loading ? '等待载入' : '暂无日期'}</b>}</span>
        <Link to="/archive">浏览新闻档案 <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
    </header>
  )
}
