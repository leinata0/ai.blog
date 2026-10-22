import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { NewsCover, NewsMeta, NewsTitle, PinnedLabel } from './NewsArticle'

export default function NewsFrontPage({ posts, onPrefetch, onPreview }) {
  if (!posts.length) return null
  const [lead, ...rest] = posts
  const supporting = rest.slice(0, 2)
  const index = rest.slice(2, 6)
  return (
    <section className="news-frontpage" aria-label="本期头条" data-ui="news-frontpage">
      <article className="news-lead" data-ui="post-card">
        <div className="news-kicker">本期头条 <span>THE BIG STORY</span><PinnedLabel post={lead} /></div>
        <NewsTitle post={lead} as="h2" onPrefetch={onPrefetch} />
        {lead.summary ? <p className="news-story-summary">{lead.summary}</p> : null}
        <NewsMeta post={lead} />
        <NewsCover post={lead} priority onPrefetch={onPrefetch} />
        <div className="news-lead__foot">
          <Link to={`/posts/${lead.slug}`} onMouseEnter={() => onPrefetch(lead.slug)}>阅读全文 <ArrowUpRight size={14} aria-hidden="true" /></Link>
          <button type="button" className="news-preview" onClick={() => onPreview(lead)}>快速预览</button>
        </div>
      </article>

      {supporting.length > 0 ? (
        <div className="news-supporting" aria-label="更多焦点">
          {supporting.map((post) => (
            <article className="news-support-story" key={post.slug}>
              <NewsCover post={post} onPrefetch={onPrefetch} />
              <NewsMeta post={post} showSources={false} />
              <NewsTitle post={post} onPrefetch={onPrefetch} />
              {post.summary ? <p className="news-story-summary">{post.summary}</p> : null}
            </article>
          ))}
        </div>
      ) : null}

      <aside className="news-front-index" aria-label="新闻速览">
        <div className="news-section-label"><h2>新闻速览</h2><span>THE INDEX</span></div>
        {index.length > 0 ? <ol className="news-index-list">
          {index.map((post, i) => (
            <li key={post.slug}>
              <span className="news-index-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
              <div><NewsTitle post={post} onPrefetch={onPrefetch} /><NewsMeta post={post} showSources={false} /></div>
            </li>
          ))}
        </ol> : <p className="news-index-note">沿主题或历史归档，继续寻找你关心的 AI 变化。</p>}
        <Link to="/archive" className="news-text-link">浏览全部归档 <ArrowRight size={14} aria-hidden="true" /></Link>
        <div className="news-index-guide">
          <span>不止于标题</span>
          <p>日报梳理事件，周报连接脉络。阅读原始来源，保留自己的判断。</p>
          <Link to="/start-here">阅读指南 <ArrowUpRight size={13} aria-hidden="true" /></Link>
        </div>
      </aside>
    </section>
  )
}
