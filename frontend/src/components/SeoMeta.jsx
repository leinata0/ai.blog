import { useEffect, useMemo } from 'react'

import { useSite } from '../contexts/SiteContext'
import { SITE_CANONICAL_ORIGIN } from '../utils/contentPresentation'

// Stable identity: a fresh `[]` default would be a new value on every render and would
// re-run the whole head-writing effect on every keystroke of pages with an input.
const EMPTY_JSON_LD = []

// Tags this component owns by upserting. They are snapshotted on mount and restored on
// unmount, otherwise a page without <SeoMeta> (404, 追踪, 标签, 友链…) keeps serving the
// canonical / og:image of whatever article the visitor came from.
const MANAGED_META_NAMES = ['description', 'robots', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']
const MANAGED_META_PROPERTIES = ['og:title', 'og:description', 'og:type', 'og:url', 'og:image']

function ensureMeta(selector, createTag) {
  let node = document.head.querySelector(selector)
  if (!node) {
    node = createTag()
    document.head.appendChild(node)
  }
  return node
}

function upsertMetaByName(name, content) {
  const selector = `meta[name="${name}"]`
  if (!content) {
    document.head.querySelector(selector)?.remove()
    return
  }
  const node = ensureMeta(selector, () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', name)
    return meta
  })
  node.setAttribute('content', content)
}

function upsertMetaByProperty(property, content) {
  const selector = `meta[property="${property}"]`
  if (!content) {
    document.head.querySelector(selector)?.remove()
    return
  }
  const node = ensureMeta(selector, () => {
    const meta = document.createElement('meta')
    meta.setAttribute('property', property)
    return meta
  })
  node.setAttribute('content', content)
}

function upsertLink(rel, href, extra = {}) {
  const selector = [
    `link[rel="${rel}"]`,
    extra.type ? `[type="${extra.type}"]` : '',
    extra.title ? `[title="${extra.title}"]` : '',
    extra['data-key'] ? `[data-key="${extra['data-key']}"]` : '',
  ].join('')
  if (!href) {
    document.head.querySelector(selector)?.remove()
    return null
  }
  const node = ensureMeta(selector, () => {
    const link = document.createElement('link')
    link.setAttribute('rel', rel)
    return link
  })
  node.setAttribute('href', href)
  Object.entries(extra).forEach(([key, value]) => {
    if (value) node.setAttribute(key, value)
  })
  return node
}

function cleanupManagedNodes(prefix) {
  document.head
    .querySelectorAll(`[data-seo-owner="${prefix}"]`)
    .forEach((node) => node.parentNode?.removeChild(node))
}

function snapshotManagedHead() {
  if (typeof document === 'undefined') return []
  const entries = MANAGED_META_NAMES.map((name) => ({
    kind: 'name',
    key: name,
    value: document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '',
  }))
  MANAGED_META_PROPERTIES.forEach((property) => {
    entries.push({
      kind: 'property',
      key: property,
      value: document.head.querySelector(`meta[property="${property}"]`)?.getAttribute('content') || '',
    })
  })
  entries.push({
    kind: 'canonical',
    key: 'canonical',
    value: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
  })
  return entries
}

function restoreManagedHead(entries) {
  entries.forEach(({ kind, key, value }) => {
    if (kind === 'name') upsertMetaByName(key, value)
    else if (kind === 'property') upsertMetaByProperty(key, value)
    else upsertLink('canonical', value)
  })
}

/**
 * Origin of the canonical link the prerendered HTML shipped with.
 *
 * `settings.site_url` is the primary source, but when it is missing we must not fall
 * back to `window.location.origin`: on the apex domain or a Vercel preview host that
 * would rewrite the www canonical the prerender wrote, and Google renders JS — the
 * rewritten value is the one it keeps.
 */
function readPrerenderedCanonicalOrigin() {
  if (typeof document === 'undefined') return ''
  const href = document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''
  if (!href) return ''
  try {
    return new URL(href, typeof window !== 'undefined' ? window.location.origin : undefined).origin
  } catch {
    return ''
  }
}

export default function SeoMeta({
  title,
  description,
  path = '',
  image = '',
  type = 'website',
  jsonLd = EMPTY_JSON_LD,
  rssUrl = '',
  noindex = false,
}) {
  const { settings } = useSite()
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    return readPrerenderedCanonicalOrigin() || SITE_CANONICAL_ORIGIN
  }, [settings?.site_url])

  useEffect(() => {
    if (!title) return
    document.title = title
  }, [title])

  useEffect(() => {
    const canonicalUrl = path
      ? `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`
      : siteUrl
    const owner = `seo-${canonicalUrl}`
    const previous = snapshotManagedHead()

    upsertMetaByName('description', description)
    upsertMetaByName('robots', noindex ? 'noindex,follow' : '')
    upsertMetaByProperty('og:title', title)
    upsertMetaByProperty('og:description', description)
    upsertMetaByProperty('og:type', type)
    upsertMetaByProperty('og:url', canonicalUrl)
    upsertMetaByName('twitter:card', image ? 'summary_large_image' : 'summary')
    upsertMetaByName('twitter:title', title)
    upsertMetaByName('twitter:description', description)
    if (image) {
      const imageUrl = /^https?:\/\//i.test(image) ? image : `${siteUrl}${image.startsWith('/') ? image : `/${image}`}`
      upsertMetaByProperty('og:image', imageUrl)
      upsertMetaByName('twitter:image', imageUrl)
    } else {
      upsertMetaByProperty('og:image', '')
      upsertMetaByName('twitter:image', '')
    }
    upsertLink('canonical', canonicalUrl)

    cleanupManagedNodes(owner)

    if (rssUrl) {
      const node = document.createElement('link')
      node.setAttribute('rel', 'alternate')
      node.setAttribute('type', 'application/rss+xml')
      node.setAttribute('title', `${title} RSS`)
      node.setAttribute('href', rssUrl)
      node.setAttribute('data-seo-owner', owner)
      document.head.appendChild(node)
    }

    const graph = Array.isArray(jsonLd) ? jsonLd.filter(Boolean) : [jsonLd].filter(Boolean)
    graph.forEach((entry, index) => {
      const script = document.createElement('script')
      script.type = 'application/ld+json'
      script.setAttribute('data-seo-owner', owner)
      script.setAttribute('data-seo-index', String(index))
      script.text = JSON.stringify(entry)
      document.head.appendChild(script)
    })

    return () => {
      cleanupManagedNodes(owner)
      restoreManagedHead(previous)
    }
  }, [description, image, jsonLd, noindex, path, rssUrl, siteUrl, title, type])

  return null
}
