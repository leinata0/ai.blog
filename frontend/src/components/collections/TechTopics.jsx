import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Search, X } from 'lucide-react'
import TechPageFrame from '../TechPageFrame'
import { formatDate, parseDate } from '../../utils/date'
import { getTopicDescription, getTopicTitle } from '../../utils/contentPresentation'
import '../../styles/tech-collections.css'

function topicEntities(items) {
  const seen = new Set()
  return items.filter((topic) => {
    const key = typeof topic?.topic_key === 'string' ? topic.topic_key.trim() : ''
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const quantity = (value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : '—'

function TopicConstellation({ topics, loading, error }) {
  return <div className="tech-topic-constellation" aria-hidden="true">
    <div className="tech-topic-constellation__orb" />
    <svg viewBox="0 0 480 360" fill="none"><circle cx="240" cy="180" r="109" /><circle cx="240" cy="180" r="145" /></svg>
    <div className="tech-topic-constellation__core"><small>TOPIC ATLAS</small><strong>{!topics.length && (loading || error) ? '—' : String(topics.length).padStart(2, '0')}</strong><span>已载入主题</span></div>
    {topics.slice(0, 3).map((topic, index) => <div className={`tech-topic-constellation__node tech-topic-constellation__node--${index + 1}`} key={topic.topic_key}><i /><span>{getTopicTitle(topic)}</span></div>)}
    <span className="tech-topic-constellation__axis">IDEAS / SIGNALS / CONTEXT</span>
  </div>
}

function TopicNode({ topic, index, onPrefetch }) {
  const latest = parseDate(topic.latest_post_at)
  return <article className={`tech-topic-node${index === 0 ? ' tech-topic-node--lead' : ''}`} data-topic-key={topic.topic_key} data-tech-reveal>
    <span className="tech-topic-node__point" aria-hidden="true" />
    <div className="tech-topic-node__index"><span>{String(index + 1).padStart(2, '0')}</span><small>{topic.is_featured ? '推荐主题' : 'TOPIC COORDINATE'}</small></div>
    <Link to={`/topics/${encodeURIComponent(topic.topic_key)}`} className="tech-topic-node__link" onMouseEnter={() => onPrefetch(topic.topic_key)} onFocus={() => onPrefetch(topic.topic_key)}>
      <h3>{getTopicTitle(topic)}<ArrowUpRight aria-hidden="true" /></h3>
      <p>{getTopicDescription(topic)}</p>
      <div className="tech-topic-node__foot"><span><b>{quantity(topic.post_count)}</b> 篇文章</span><span>{quantity(topic.source_count)} 条来源</span><ArrowUpRight size={18} aria-hidden="true" /></div>
    </Link>
    {latest ? <span className="tech-topic-node__date">最近发布 <time dateTime={latest.toISOString()}>{formatDate(topic.latest_post_at)}</time></span> : null}
  </article>
}

export default function TechTopics({ topics, loading, error, onRetry, onPrefetch }) {
  const [query, setQuery] = useState('')
  const entities = useMemo(() => topicEntities(topics), [topics])
  const matches = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return keyword ? entities.filter((topic) => `${getTopicTitle(topic)} ${getTopicDescription(topic)} ${topic.topic_key}`.toLocaleLowerCase().includes(keyword)) : entities
  }, [entities, query])

  return <TechPageFrame section="topics" index="03 / TOPIC INDEX" title="主题坐标" accentTitle="把线索，串成上下文。" description="按公司、模型与事件整理报道。选择一个你关心的主题，沿文章与原始来源继续阅读。"
    meta={<><span>主题总览</span><span>{loading && !entities.length ? '正在载入主题' : error && !entities.length ? '主题数量暂不可用' : `${entities.length} 个主题入口`}</span></>}
    actions={<a href="#topic-coordinates">探索主题坐标 <ArrowUpRight size={16} aria-hidden="true" /></a>}
    visual={<TopicConstellation topics={entities} loading={loading} error={error} />}>
    <section className="tech-topic-explorer" id="topic-coordinates" aria-labelledby="tech-topic-explorer-title" data-ui="tech-topic-atlas">
      <div className="tech-collections-section-heading"><div><span>FIND A THREAD</span><h2 id="tech-topic-explorer-title">主题索引<span>每条主线，都有上下文。</span></h2></div><p>选择一个主题，沿文章与原始来源继续阅读。</p></div>
      <div className="tech-topic-search"><Search size={18} aria-hidden="true" /><label className="tech-collections-sr-only" htmlFor="topic-local-search">筛选已载入主题</label><input id="topic-local-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="在已载入主题中搜索…" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="清空主题筛选"><X size={16} aria-hidden="true" /></button> : null}<span aria-live="polite">{loading ? '载入中' : error && !entities.length ? '暂不可用' : `${matches.length} / ${entities.length}`}</span></div>
      {loading && !entities.length ? <div className="tech-collections-loading" role="status"><span>正在绘制主题坐标…</span><div /><div /><div /></div> : null}
      {error ? <div className="tech-collections-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重新加载主题 <ArrowUpRight size={15} aria-hidden="true" /></button></div> : null}
      {matches.length ? <div className="tech-topic-atlas">{matches.map((topic, index) => <TopicNode key={topic.topic_key} topic={topic} index={index} onPrefetch={onPrefetch} />)}</div> : !loading && !error ? <div className="tech-collections-empty"><h3>{query ? '没有匹配的主题坐标' : '新的主题，等待下一条线索。'}</h3><p>{query ? '试试公司、模型或主题名称。这里只筛选当前已载入的主题。' : '主题发布后，会在这里形成可继续阅读的入口。'}</p>{query ? <button type="button" onClick={() => setQuery('')}>查看全部已载入主题</button> : <Link to="/discover">先去发现文章 <ArrowUpRight size={16} aria-hidden="true" /></Link>}</div> : null}
    </section>
  </TechPageFrame>
}
