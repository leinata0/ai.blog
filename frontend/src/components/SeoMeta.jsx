import { useEffect, useMemo } from 'react'

import { useSite } from '../contexts/SiteContext'

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

export default function SeoMeta({
  title,
  description,
  path = '',
  image = '',
  type = 'website',
  jsonLd = [],
  rssUrl = '',
}) {
  const { settings } = useSite()
  const siteUrl = useMemo(() => {
    const configured = String(settings?.site_url || '').trim().replace(/\/$/, '')
    if (configured) return configured
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  }, [settings?.site_url])

  useEffect(() => {
    if (!title) return
    document.title = title
  }, [title])

  useEffect(() => {
    const canonicalUrl = path
      ? `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`
      : (typeof window !== 'undefined' ? window.location.href : siteUrl)
    const owner = `seo-${canonicalUrl}`

    upsertMetaByName('description', description)
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
    }
  }, [description, image, jsonLd, path, rssUrl, siteUrl, title, type])

  return null
}
