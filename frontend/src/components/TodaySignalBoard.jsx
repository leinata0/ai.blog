import { Link } from 'react-router-dom'
import { ArrowUpRight, Activity, Radio, Sparkles } from 'lucide-react'

import { formatDate } from '../utils/date'
import { getContentTypeLabel } from '../utils/contentPresentation'

export default function TodaySignalBoard({ posts = [], loading = false }) {
  const signals = posts.slice(0, 4)
  const lead = signals[0]
  const topicCount = new Set(signals.map((post) => post.topic_key).filter(Boolean)).size
  const typeCount = new Set(signals.map((post) => post.content_type).filter(Boolean)).size

  return (
    <aside className="signal-board" data-ui="today-signal-board" aria-label="今日 AI 信号台">
      <header className="signal-board__header">
        <div>
          <span className="signal-board__live"><span aria-hidden="true" /> LIVE SIGNAL</span>
          <h2>今日 AI 信号台</h2>
        </div>
        <Radio size={20} aria-hidden="true" />
      </header>

      <div className="signal-board__metrics" aria-label="信号概览">
        <div><strong>{signals.length}</strong><span>最新信号</span></div>
        <div><strong>{topicCount || '—'}</strong><span>关联主题</span></div>
        <div><strong>{typeCount || '—'}</strong><span>内容轨道</span></div>
      </div>

      {loading && !lead ? (
        <div className="signal-board__loading" role="status">正在校准今日信号…</div>
      ) : lead ? (
        <Link to={`/posts/${lead.slug}`} className="signal-board__lead">
          <span className="signal-board__lead-meta">
            <Sparkles size={13} aria-hidden="true" />
            主信号 · {getContentTypeLabel(lead.content_type)}
          </span>
          <strong>{lead.title}</strong>
          <span className="line-clamp-2">{lead.summary}</span>
          <span className="signal-board__lead-action">进入信号 <ArrowUpRight size={15} aria-hidden="true" /></span>
        </Link>
      ) : (
        <div className="signal-board__loading">今日信号正在整理中。</div>
      )}

      <div className="signal-board__stream">
        {signals.slice(1).map((post, index) => (
          <Link key={post.slug} to={`/posts/${post.slug}`} className="signal-stream-item">
            <span className="signal-stream-item__index">0{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="signal-stream-item__meta">{getContentTypeLabel(post.content_type)} · {formatDate(post.created_at)}</span>
              <strong>{post.title}</strong>
            </span>
            <Activity size={15} aria-hidden="true" />
          </Link>
        ))}
      </div>

      <footer className="signal-board__footer">
        <span>持续校准</span>
        <span>编辑筛选</span>
        <span>上下文连接</span>
      </footer>
    </aside>
  )
}
