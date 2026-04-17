export function buildSubscriptionCenterHref({
  contentType = '',
  topicKey = '',
  seriesSlug = '',
} = {}) {
  const params = new URLSearchParams()
  if (contentType) params.set('content_type', contentType)
  if (topicKey) params.set('topic_key', topicKey)
  if (seriesSlug) params.set('series_slug', seriesSlug)
  const query = params.toString()
  return query ? `/feeds?${query}` : '/feeds'
}
