import { Link } from 'react-router-dom'
import { ArrowUpRight, Rss, Search } from 'lucide-react'

import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { openCommandPalette } from '../utils/uiEvents'

export default function Footer() {
  return (
    <footer className="news-footer" data-surface="editorial">
      <div className="news-shell-container">
        <div className="news-footer-main">
          <div className="news-footer-brand">
            <Link to="/" className="news-footer-name">AI 资讯观察</Link>
            <span translate="no">AI OBSERVER</span>
            <p>读懂人工智能，关注技术如何改变世界。</p>
          </div>
          <nav aria-label="页脚导航" className="news-footer-links">
            <div>
              <span>新闻与观察</span>
              <Link to="/daily">AI 日报</Link>
              <Link to="/weekly">AI 周报</Link>
              <Link to="/topics">主题追踪</Link>
              <Link to="/series">专题系列</Link>
              <Link to="/discover">发现更多</Link>
            </div>
            <div>
              <span>阅读与订阅</span>
              <Link to="/archive">全部归档</Link>
              <Link to="/feeds">订阅中心</Link>
              <Link to="/following">我的追踪</Link>
              <a href={buildPublicApiUrl('/feed.xml')}><Rss size={12} aria-hidden="true" /> RSS <ArrowUpRight size={12} aria-hidden="true" /></a>
            </div>
          </nav>
          <div className="news-footer-search">
            <span>寻找一条新闻？</span>
            <button type="button" onClick={openCommandPalette}><Search size={15} aria-hidden="true" /> 搜索文章与主题 <ArrowUpRight size={14} aria-hidden="true" /></button>
            <Link to="/start-here">从这里开始阅读 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
        <div className="news-footer-bottom">
          <span>&copy; {new Date().getFullYear()} AI 资讯观察</span>
          <p>阅读原始来源，保留独立判断。</p>
          <Link to="/admin/login">管理</Link>
        </div>
      </div>
    </footer>
  )
}
