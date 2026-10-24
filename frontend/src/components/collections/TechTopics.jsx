import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowUpRight, Search, X } from 'lucide-react'
import SectionCover from '../news/cinematic/SectionCover'
import { formatDate, parseDate } from '../../utils/date'
import { getTopicDescription, getTopicTitle } from '../../utils/contentPresentation'
import '../../styles/cinematic-topics.css'

function topicEntities(items) {
  const seen = new Set()
  return items.flatMap((topic) => {
    const key = typeof topic?.topic_key === 'string' ? topic.topic_key.trim() : ''
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ ...topic, topic_key: key }]
  })
}

const quantity = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : '—'
const topicUrl = (topic) => `/topics/${encodeURIComponent(topic.topic_key)}`

function TopicDate({ topic }) {
  const latest = parseDate(topic.latest_post_at)
  return latest ? <time dateTime={latest.toISOString()}>{formatDate(topic.latest_post_at)}</time> : null
}

function TopicNode({ topic, index, onPrefetch }) {
  return <article className="cinema-topic-entry tech-topic-node" data-topic-key={topic.topic_key}>
    <span className="cinema-topic-entry__number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
    <Link className="cinema-topic-entry__link" to={topicUrl(topic)} onMouseEnter={() => onPrefetch?.(topic.topic_key)} onFocus={() => onPrefetch?.(topic.topic_key)}>
      <div className="cinema-topic-entry__image"><SectionCover src={topic.cover_image} title={getTopicTitle(topic)} /></div>
      <div className="cinema-topic-entry__copy"><span>{topic.is_featured ? '推荐主题' : '持续追踪'}</span><h3>{getTopicTitle(topic)}</h3><div className="cinema-topic-entry__meta"><span>{quantity(topic.post_count)} 篇文章</span><span>{quantity(topic.source_count)} 条来源</span></div></div>
      <ArrowUpRight className="cinema-topic-entry__arrow" size={27} aria-hidden="true" />
    </Link>
    <div className="cinema-topic-entry__date">{parseDate(topic.latest_post_at) ? <>最近发布 <TopicDate topic={topic} /></> : '沿报道回看变化'}</div>
  </article>
}

export default function TechTopics({ topics = [], loading, error, onRetry, onPrefetch }) {
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const reduceMotion = useReducedMotion()
  const entities = useMemo(() => topicEntities(topics), [topics])
  const matches = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase()
    return keyword ? entities.filter((topic) => `${getTopicTitle(topic)} ${getTopicDescription(topic)} ${topic.topic_key}`.toLocaleLowerCase().includes(keyword)) : entities
  }, [entities, query])
  const active = matches.find((topic) => topic.topic_key === selectedKey) || matches[0] || entities[0]
  const duration = reduceMotion ? 0 : .55

  return <div className="cinema-layout cinema-topics" data-ui="tech-topic-atlas">
    <section className="cinema-hero cinema-topics-hero" id="topic-spotlight" aria-labelledby="cinema-topics-title">
      <div className="cinema-topics-hero__images" aria-hidden="true"><AnimatePresence initial={false}>{active ? <motion.div className="cinema-topics-hero__image" key={active.topic_key} initial={{ opacity: 0, scale: reduceMotion ? 1 : 1.025 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ opacity: { duration }, scale: { duration: reduceMotion ? 0 : .85, ease: [.2, .65, .3, 1] } }}><SectionCover src={active.cover_image} title={getTopicTitle(active)} eager /></motion.div> : null}</AnimatePresence></div>
      <div className="cinema-topics-hero__shade" aria-hidden="true" />
      <header className="cinema-topics-hero__masthead"><div><span className="cinema-kicker">03 / TOPIC ATLAS</span><h1 id="cinema-topics-title">主题坐标</h1></div><p>跨越单条新闻，<br />看见持续发生的变化。</p><span className="cinema-topics-hero__count"><b>{loading && !entities.length || error && !entities.length ? '—' : String(entities.length).padStart(2, '0')}</b><span>主题总览</span></span></header>
      {active ? <div className="cinema-topics-stage">
        <div className="cinema-topics-spotlight" aria-live="polite" aria-atomic="true"><motion.div key={active.topic_key} initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : .36, ease: [.2, .65, .3, 1] }}><span className="cinema-topics-spotlight__label">{active.is_featured ? '推荐追踪 / FEATURED THREAD' : '跟随一条主线 / FOLLOW A THREAD'}</span><p className="cinema-topics-spotlight__title">{getTopicTitle(active)}</p><p className="cinema-topics-spotlight__description">{getTopicDescription(active)}</p><div className="cinema-topics-spotlight__meta"><span>{quantity(active.post_count)} 篇文章</span><span>{quantity(active.source_count)} 条来源</span>{parseDate(active.latest_post_at) ? <span>最近发布 <TopicDate topic={active} /></span> : null}</div><Link className="cinema-button" to={topicUrl(active)} onMouseEnter={() => onPrefetch?.(active.topic_key)} onFocus={() => onPrefetch?.(active.topic_key)} aria-label={`进入主题：${getTopicTitle(active)}`}>进入这条主线 <ArrowUpRight size={18} aria-hidden="true" /></Link></motion.div></div>
        <div className="cinema-topics-selector"><span className="cinema-topics-selector__caption">切换观察视角 <span>SELECT A THREAD</span></span><div className="cinema-topics-selector__items" role="group" aria-label="选择预览主题">{entities.map((topic, index) => <button key={topic.topic_key} type="button" aria-pressed={active.topic_key === topic.topic_key} onClick={() => { setSelectedKey(topic.topic_key); setQuery('') }} onMouseEnter={() => onPrefetch?.(topic.topic_key)} onFocus={() => onPrefetch?.(topic.topic_key)}><span>{String(index + 1).padStart(2, '0')}</span><span>{getTopicTitle(topic)}</span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div></div>
      </div> : <div className="cinema-topics-hero__state cinema-state">{loading ? <p role="status">正在绘制主题坐标…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="cinema-button" onClick={onRetry}>重新加载主题 <ArrowUpRight size={16} aria-hidden="true" /></button></div> : <><p>新的主题，等待下一条线索。</p><Link className="cinema-button" to="/discover">先去发现文章 <ArrowUpRight size={16} aria-hidden="true" /></Link></>}</div>}
      <a className="cinema-topics-hero__scroll" href="#topic-coordinates"><span>浏览全部主题</span><ArrowDown size={17} aria-hidden="true" /></a>
    </section>
    <section className="cinema-body cinema-topics-index" id="topic-coordinates" aria-labelledby="cinema-topics-index-title">
      <div className="cinema-section-heading"><div><span className="cinema-kicker">THE THREAD INDEX</span><h2 id="cinema-topics-index-title">找到你关心的主线。</h2></div><p>按公司、模型与事件继续阅读。这里展示已载入的主题，文章与原始来源都保留在各自的主题页。</p></div>
      <div className="cinema-topics-search"><Search size={19} aria-hidden="true" /><label className="cinema-sr-only" htmlFor="topic-local-search">筛选已载入主题</label><input id="topic-local-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司、模型或主题…" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="清空主题筛选"><X size={18} aria-hidden="true" /></button> : null}<span role="status">{loading ? '载入中' : error && !entities.length ? '暂不可用' : `${matches.length} / ${entities.length}`}</span></div>
      {loading && !entities.length ? <div className="cinema-state" role="status">正在载入主题索引…</div> : null}
      {error && entities.length > 0 ? <div className="cinema-state cinema-topics-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>重新加载主题 <ArrowUpRight size={15} aria-hidden="true" /></button></div> : null}
      {matches.length ? <div className="cinema-topics-entries">{matches.map((topic, index) => <TopicNode key={topic.topic_key} topic={topic} index={index} onPrefetch={onPrefetch} />)}</div> : !loading && !error ? <div className="cinema-state"><h3>{query ? '没有匹配的主题坐标' : '主题索引暂为空'}</h3><p>{query ? '试试公司、模型或主题名称。这里只筛选当前已载入的主题。' : '主题发布后，会在这里形成可继续阅读的入口。'}</p>{query ? <button type="button" onClick={() => setQuery('')}>查看全部已载入主题</button> : null}</div> : null}
      <div className="cinema-topics-follow"><p>有一条主线，值得继续跟下去。</p><Link to="/feeds" className="cinema-button">选择订阅主题 <ArrowUpRight size={17} aria-hidden="true" /></Link></div>
    </section>
  </div>
}
