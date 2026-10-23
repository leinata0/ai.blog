// These are search entry points, not inferred categories for individual articles.
export const NEWS_BEATS = Object.freeze([
  { title: '模型与产品', query: '模型', code: '01' },
  { title: '研究前沿', query: '研究', code: '02' },
  { title: '开源与工具', query: '开源', code: '03' },
  { title: '算力与产业', query: '算力', code: '04' },
  { title: '治理与安全', query: '治理', code: '05' },
].map(Object.freeze))

function validPost(post) {
  if (typeof post?.slug !== 'string' || typeof post?.title !== 'string') return null
  const slug = post.slug.trim()
  const title = post.title.trim()
  if (!slug || !title) return null
  return slug === post.slug && title === post.title ? post : { ...post, slug, title }
}

function uniquePosts(posts) {
  const seen = new Set()
  return (Array.isArray(posts) ? posts : []).flatMap((candidate) => {
    const post = validPost(candidate)
    if (!post || seen.has(post.slug)) return []
    seen.add(post.slug)
    return [post]
  })
}

/** Preserve the API's editorial order, including any pinned lead stories. */
export function buildNewsroomSections(posts = [], modules = {}) {
  const orderedPosts = uniquePosts(posts)
  const focus = orderedPosts.slice(0, 3)
  const usedSlugs = new Set(focus.map((post) => post.slug))
  const deepReads = []

  const weeklyPosts = Array.isArray(modules?.latest_weekly) ? modules.latest_weekly : []
  for (const candidate of weeklyPosts) {
    const post = validPost(candidate)
    if (!post || post.content_type !== 'weekly_review' || usedSlugs.has(post.slug)) continue
    deepReads.push(post)
    usedSlugs.add(post.slug)
    if (deepReads.length === 2) break
  }

  const stream = orderedPosts.filter((post) => !usedSlugs.has(post.slug))
  return { focus, stream, deepReads }
}
