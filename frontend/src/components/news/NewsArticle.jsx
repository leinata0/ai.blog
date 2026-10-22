import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Pin } from 'lucide-react'
import { formatDate, parseDate } from '../../utils/date'
import { getContentTypeLabel } from '../../utils/contentPresentation'
import { proxyImageUrl } from '../../utils/proxyImage'

export function NewsMeta({ post, showSources = true }) {
  const published = parseDate(post.created_at)
  return (
    <div className="news-meta">
      <span className="news-meta__kind">{getContentTypeLabel(post.content_type)}</span>
      {published ? <time dateTime={published.toISOString()}>{formatDate(post.created_at)}</time> : <span>日期待补充</span>}
      {showSources && Number(post.source_count) > 0 ? <span>{post.source_count} 个来源</span> : null}
      {Number(post.reading_time) > 0 ? <span>{post.reading_time} 分钟阅读</span> : null}
    </div>
  )
}

export function NewsCover({ post, className = '', priority = false, onPrefetch }) {
  const src = proxyImageUrl(post.cover_image)
  const [failedSrc, setFailedSrc] = useState(null)
  if (!src || failedSrc === src) return null
  return (
    <Link to={`/posts/${post.slug}`} className={`news-cover ${className}`} aria-label={`阅读：${post.title}`}
      onMouseEnter={() => onPrefetch?.(post.slug)} onFocus={() => onPrefetch?.(post.slug)}>
      <img src={src} alt={post.title} width="1200" height="630" loading={priority ? 'eager' : 'lazy'}
        fetchpriority={priority ? 'high' : undefined} referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
    </Link>
  )
}

export function NewsTitle({ post, as: Heading = 'h3', onPrefetch }) {
  return (
    <Heading className="news-title">
      <Link to={`/posts/${post.slug}`} onMouseEnter={() => onPrefetch?.(post.slug)} onFocus={() => onPrefetch?.(post.slug)}>
        {post.title}
      </Link>
    </Heading>
  )
}

export function PinnedLabel({ post }) {
  return post.is_pinned ? (
    <span className="news-pin" style={{ color: 'var(--text-primary)', backgroundColor: 'var(--signal-warm-soft)' }}>
      <Pin size={11} aria-hidden="true" /> 推荐
    </span>
  ) : null
}

export default function NewsArticle({ post, onPrefetch, onPreview, onTagSelect }) {
  return (
    <article className="news-list-story" data-ui="post-card">
      <div className="news-list-story__body">
        <NewsMeta post={post} />
        <NewsTitle post={post} onPrefetch={onPrefetch} />
        {post.summary ? <p className="news-story-summary">{post.summary}</p> : null}
        <div className="news-story-foot">
          <div className="news-story-tags">
            {(post.tags || []).slice(0, 3).map((tag) => (
              <button type="button" key={tag.slug} onClick={() => onTagSelect(tag.slug)}>#{tag.name}</button>
            ))}
          </div>
          <button type="button" className="news-preview" onClick={() => onPreview(post)}>快速预览 <ArrowUpRight size={13} aria-hidden="true" /></button>
        </div>
      </div>
      <NewsCover post={post} onPrefetch={onPrefetch} />
    </article>
  )
}
