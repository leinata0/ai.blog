import { Link } from 'react-router-dom'
import { ArrowUpRight, Command, Radio } from 'lucide-react'

import { buildPublicApiUrl } from '../utils/publicApiUrl'
import { openCommandPalette } from '../utils/uiEvents'

export default function Footer() {
  return (
    <footer className="editorial-footer">
      <div className="editorial-footer__grid">
        <div className="editorial-footer__brand">
          <span className="signal-board__live"><span aria-hidden="true" /> INTELLIGENCE DESK</span>
          <h2>让每一条 AI 变化<br />拥有可追踪的上下文。</h2>
          <p>不是堆积新闻，而是持续校准信号、主题与长期变化。</p>
          <button type="button" onClick={openCommandPalette} className="signal-button signal-button--primary">
            <Command size={16} aria-hidden="true" /> 打开智能搜索
          </button>
        </div>

        <nav aria-label="页脚导航" className="editorial-footer__links">
          <div>
            <span>EXPLORE</span>
            <Link to="/discover">发现</Link>
            <Link to="/topics">主题</Link>
            <Link to="/series">系列</Link>
            <Link to="/archive">归档</Link>
          </div>
          <div>
            <span>FOLLOW</span>
            <Link to="/feeds">订阅中心</Link>
            <Link to="/following">我的追踪</Link>
            <Link to="/start-here">开始阅读</Link>
            <a href={buildPublicApiUrl('/feed.xml')}>RSS <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </nav>
      </div>

      <div className="editorial-footer__bottom">
        <span className="inline-flex items-center gap-2"><Radio size={13} aria-hidden="true" /> Signal online</span>
        <div>
          <span>&copy; {new Date().getFullYear()} AI 资讯观察</span>
          <span>&middot;</span>
          <Link to="/admin/login">管理</Link>
        </div>
      </div>
    </footer>
  )
}
