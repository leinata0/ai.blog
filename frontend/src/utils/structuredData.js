function absoluteUrl(siteUrl, path = '/') {
  const base = String(siteUrl || '').replace(/\/$/, '')
  if (!base) return path
  if (/^https?:\/\//i.test(path)) return path
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function normalizeImage(siteUrl, image) {
  const value = String(image || '').trim()
  if (!value) return undefined
  return absoluteUrl(siteUrl, value)
}

export function buildBreadcrumbJsonLd({ siteUrl, items = [] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(siteUrl, item.path),
    })),
  }
}

export function buildWebSiteJsonLd({ siteUrl, name, description }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name,
    description,
    url: absoluteUrl(siteUrl, '/'),
    potentialAction: {
      '@type': 'SearchAction',
      target: `${absoluteUrl(siteUrl, '/search')}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

export function buildCollectionPageJsonLd({
  siteUrl,
  name,
  description,
  path,
  image,
  about = [],
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: absoluteUrl(siteUrl, path),
    image: normalizeImage(siteUrl, image),
    about,
  }
}

export function buildArticleJsonLd({
  siteUrl,
  title,
  description,
  path,
  image,
  datePublished,
  dateModified,
  authorName,
  publisherName,
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    description,
    url: absoluteUrl(siteUrl, path),
    image: normalizeImage(siteUrl, image),
    datePublished,
    dateModified: dateModified || datePublished,
    author: {
      '@type': 'Person',
      name: authorName || publisherName,
    },
    publisher: {
      '@type': 'Organization',
      name: publisherName,
      url: absoluteUrl(siteUrl, '/'),
      logo: normalizeImage(siteUrl, image) || absoluteUrl(siteUrl, '/favicon.ico'),
    },
  }
}

export function buildDefinedTerm(name, url) {
  return {
    '@type': 'DefinedTerm',
    name,
    url,
  }
}
