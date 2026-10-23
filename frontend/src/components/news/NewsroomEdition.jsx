import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpen } from 'lucide-react'
import { NewsCover, NewsMeta, NewsTitle, PinnedLabel } from './NewsArticle'
import NewsroomCollections from './NewsroomCollections'
import { NEWS_BEATS } from '../../utils/newsroom'
import { formatDate } from '../../utils/date'
import '../../styles/newsroom-edition.css'

function MissingCover() {
  return <div className="newsroom-cover-fallback" aria-hidden="true"><span>THE AI OBSERVER</span><b>AI.</b><small>NEWS & PERSPECTIVES</small></div>
}

function FocusStory({ post, lead = false, onPrefetch, onPreview }) {
  return <article className={`newsroom-focus-story${lead ? ' newsroom-focus-story--lead' : ''}`} data-story-slug={post.slug} data-ui="post-card">
    <div className="newsroom-focus-story__visual">
      <MissingCover />
      <NewsCover post={post} priority={lead} onPrefetch={onPrefetch} />
      <span className="newsroom-focus-story__caption" aria-hidden="true">{lead ? 'THE BIG PICTURE' : 'ALSO IN FOCUS'}</span>
    </div>
    <div className="newsroom-focus-story__copy">
      <PinnedLabel post={post} />
      <NewsMeta post={post} />
      <NewsTitle post={post} onPrefetch={onPrefetch} />
      {post.summary ? <p>{post.summary}</p> : null}
      <div className="newsroom-story-actions"><Link to={`/posts/${post.slug}`} onMouseEnter={() => onPrefetch?.(post.slug)}>阅读全文 <ArrowUpRight size={15} aria-hidden="true" /></Link><button type="button" onClick={() => onPreview(post)}>快速预览 <ArrowRight size={14} aria-hidden="true" /></button></div>
    </div>
  </article>
}

function DeepReads({ posts, loading, error, onRetry, onPrefetch, onPreview }) {
  return <aside className="newsroom-deepreads" aria-label="周报深读">
    <header><span><BookOpen size={15} aria-hidden="true" /> THE LONG VIEW</span><h2>换个尺度，<br /><em>看清变化。</em></h2><p>用一份周报，把分散的消息连成脉络。</p></header>
    {posts.map((post) => <article key={post.slug} className="newsroom-deepread" data-story-slug={post.slug}>
      <NewsCover post={post} onPrefetch={onPrefetch} />
      <NewsMeta post={post} />
      <NewsTitle post={post} onPrefetch={onPrefetch} />
      <button type="button" onClick={() => onPreview(post)}>快速预览 <ArrowUpRight size={14} aria-hidden="true" /></button>
    </article>)}
    {!posts.length && loading ? <p className="newsroom-module-note" role="status">正在整理深读内容…</p> : null}
    {!posts.length && !loading && error ? <p className="newsroom-module-note">深读内容暂时无法载入。<button type="button" onClick={onRetry}>重试深读</button></p> : null}
    <Link className="newsroom-deepreads__all" to="/weekly">浏览全部周报 <ArrowUpRight size={17} aria-hidden="true" /></Link>
    <div className="newsroom-reading-note"><span>阅读之前</span><p>先看日期，再看来源。历史报道保留当时的背景，后续进展可沿主题继续寻找。</p><Link to="/start-here">阅读指南 <ArrowRight size={14} aria-hidden="true" /></Link></div>
  </aside>
}

export default function NewsroomEdition({ focus, deepReads, latestDate, loading, error, modules, topics, moduleLoading, moduleError, deepReadsError, onRetryModules, onPrefetch, onPreview, children }) {
  return <div className="newsroom-edition">
    <section id="edition-focus" className="newsroom-focus edition-focus" data-edition-chapter aria-label="本期头条" data-ui="news-frontpage">
      <header className="newsroom-section-head"><div><span>01 / IN FOCUS</span><h2>焦点报道<span aria-hidden="true">.</span></h2></div><div className="newsroom-issue-date"><span>本页最新发布</span>{latestDate ? <time dateTime={latestDate.toISOString()}>{formatDate(latestDate.toISOString())}</time> : <span>{loading ? '等待载入' : error ? '日期暂不可用' : '暂无发布日期'}</span>}<a href="#edition-news">直接浏览新闻 <ArrowRight size={14} aria-hidden="true" /></a></div></header>
      {focus.length ? <div className="newsroom-focus-grid"><FocusStory post={focus[0]} lead onPrefetch={onPrefetch} onPreview={onPreview} /><div className="newsroom-focus-support">{focus.slice(1).map((post) => <FocusStory key={post.slug} post={post} onPrefetch={onPrefetch} onPreview={onPreview} />)}</div></div> : <p className="newsroom-focus-empty">{loading ? '焦点报道正在载入…' : error ? '焦点报道暂时无法载入，请在下方重试。' : '新的报道发布后，会在这里呈现。'}</p>}
    </section>
    <nav className="newsroom-beats" aria-label="新闻领域"><span>按领域查找</span>{NEWS_BEATS.map((beat) => <Link key={beat.query} to={`/search?q=${encodeURIComponent(beat.query)}`}><small>{beat.code}</small>{beat.title}<ArrowUpRight size={13} aria-hidden="true" /></Link>)}</nav>
    <div className="newsroom-reading-grid" id="edition-news" data-edition-chapter>
      {children}
      <DeepReads posts={deepReads} loading={moduleLoading} error={deepReadsError} onRetry={onRetryModules} onPrefetch={onPrefetch} onPreview={onPreview} />
    </div>
    <NewsroomCollections modules={modules} topics={topics} loading={moduleLoading} error={moduleError} onRetry={onRetryModules} />
  </div>
}
