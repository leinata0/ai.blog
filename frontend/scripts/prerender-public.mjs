#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SITE_SEO } from '../src/utils/contentPresentation.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distDir = resolve(__dirname, '..', 'dist')
const templatePath = join(distDir, 'index.html')

// Cap concurrent detail fetches so large archives do not stampede the API.
const PRERENDER_FETCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.PRERENDER_FETCH_CONCURRENCY || '8', 10) || 8,
)
const PRERENDER_FETCH_ATTEMPTS = Math.max(
  1,
  Math.min(5, Number.parseInt(process.env.PRERENDER_FETCH_ATTEMPTS || '3', 10) || 3),
)
const PRERENDER_FETCH_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.PRERENDER_FETCH_TIMEOUT_MS || '30000', 10) || 30000,
)
// A detail fetch that fails is silently dropped from the output, and the SPA
// catch-all then serves the *home page* under that URL (HTTP 200 + wrong canonical
// = soft 404). Fail the build instead of shipping a partially generated site.
const PRERENDER_MIN_DETAIL_RATIO = Math.min(
  1,
  Math.max(0, Number.parseFloat(process.env.PRERENDER_MIN_DETAIL_RATIO || '0.9') || 0.9),
)

// Single shared source with index.html and runtime <SeoMeta>; see src/utils/contentPresentation.js.
const SITE_TITLE = SITE_SEO.brand
const HOME_TITLE = SITE_SEO.homeTagline
const HOME_DESCRIPTION = SITE_SEO.homeDescription
const PRERENDER_STYLE = `
  <style data-prerender>
    .prerender-shell{max-width:1100px;margin:0 auto;padding:48px 24px 72px;color:#111827;font-family:"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
    .prerender-hero{padding:32px 0 24px;border-bottom:1px solid rgba(15,23,42,.08)}
    .prerender-kicker{display:inline-block;padding:6px 12px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .prerender-shell h1{margin:16px 0 12px;font-size:40px;line-height:1.12}
    .prerender-shell h2{margin:0 0 10px;font-size:28px;line-height:1.2}
    .prerender-shell h3{margin:0 0 8px;font-size:20px;line-height:1.35}
    .prerender-lead{max-width:760px;font-size:18px;line-height:1.8;color:#475569}
    .prerender-grid{display:grid;gap:18px}
    .prerender-grid.cols-2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
    .prerender-grid.cols-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
    .prerender-section{margin-top:32px}
    .prerender-card,.prerender-panel{display:block;padding:18px 20px;border-radius:22px;border:1px solid rgba(15,23,42,.08);background:#fff;box-shadow:0 18px 40px rgba(15,23,42,.05);text-decoration:none;color:inherit}
    .prerender-card img,.prerender-cover{width:100%;height:220px;object-fit:cover;border-radius:16px;margin-bottom:14px;background:linear-gradient(135deg,#e2e8f0,#f8fafc)}
    .prerender-meta{display:flex;flex-wrap:wrap;gap:12px;margin:10px 0 0;font-size:12px;color:#64748b}
    .prerender-summary{margin:10px 0 0;color:#475569;line-height:1.8}
    .prerender-list{display:grid;gap:14px;margin-top:18px}
    .prerender-list-item{display:block;padding:14px 16px;border-radius:18px;background:#f8fafc;text-decoration:none;color:inherit}
    .prerender-chip-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
    .prerender-chip{display:inline-flex;padding:8px 12px;border-radius:999px;background:#f1f5f9;color:#334155;font-size:12px;font-weight:600;text-decoration:none}
    .prerender-caption{font-size:12px;color:#64748b;letter-spacing:.08em;text-transform:uppercase}
    .prerender-date-group{margin-top:22px}
    .prerender-date-group h3{font-size:16px}
    @media (max-width: 640px){
      .prerender-shell{padding:28px 18px 56px}
      .prerender-shell h1{font-size:30px}
      .prerender-shell h2{font-size:22px}
    }
  </style>
`

function normalizeUrl(value, fallback = '') {
  return String(value || fallback || '').trim().replace(/\/$/, '')
}

function envFlag(value) {
  return /^(1|true|yes)$/i.test(String(value || '').trim())
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[>*_~-]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(value, max = 180) {
  const text = String(value || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max).trim()}...`
}

// Mirrors src/utils/date.js: the backend has historically returned naive timestamps,
// which must be read as UTC rather than as build-machine local time.
const NAIVE_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

export function formatDate(value) {
  const text = String(value || '').trim()
  if (!text) return '持续更新'
  let normalized = text
  if (NAIVE_DATE_ONLY.test(text)) normalized = `${text}T00:00:00Z`
  else if (NAIVE_DATETIME.test(text)) normalized = `${text.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return text
  // Same shape as src/utils/date.js (`2026/07/17`) so the prerendered markup does not
  // visibly change on hydration, and pinned to UTC so a UTC build machine and a
  // visitor in another timezone cannot disagree by a day.
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(parsed)
}

function canonicalUrl(siteUrl, routePath) {
  if (!siteUrl) return routePath || '/'
  if (!routePath || routePath === '/') return siteUrl
  return `${siteUrl}${routePath}`
}

export function bootstrapScript(payload) {
  if (!payload) return ''
  // The payload is embedded in an inline <script>: `</` would close the element early,
  // and U+2028 / U+2029 are literal line terminators in JS source even though JSON
  // allows them raw inside strings.
  const serialized = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return `<script>window.__BLOG_BOOTSTRAP__=${serialized};</script>`
}

/**
 * Map over items with a fixed concurrency cap (order-preserving).
 * Used for prerender detail fetches so large archives do not open
 * hundreds of simultaneous connections against the API.
 */
export async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : []
  const limit = Math.max(1, Number(concurrency) || 1)
  if (list.length === 0) return []

  const results = new Array(list.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < list.length) {
      const current = nextIndex
      nextIndex += 1
      results[current] = await mapper(list[current], current)
    }
  }

  const workers = Array.from({ length: Math.min(limit, list.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

export async function fetchWithRetry(url, init = {}, {
  attempts = PRERENDER_FETCH_ATTEMPTS,
  fetchImpl = fetch,
  waitImpl = wait,
} = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: init.signal || AbortSignal.timeout(PRERENDER_FETCH_TIMEOUT_MS),
      })
      if (response.status !== 429 && response.status < 500) {
        return response
      }
      lastError = new Error(`Transient prerender response: ${response.status}`)
      await response.body?.cancel?.()
    } catch (error) {
      lastError = error
    }
    if (attempt < attempts) {
      await waitImpl(250 * (2 ** (attempt - 1)))
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`)
}

async function fetchJson(apiBase, path) {
  const response = await fetchWithRetry(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'blog-prerender/1.0',
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path}: ${response.status}`)
  }
  return response.json()
}

async function fetchJsonWithStatus(apiBase, path) {
  const response = await fetchWithRetry(`${apiBase}${path}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'blog-prerender/1.0',
    },
  })

  let data = null
  if (response.ok) {
    data = await response.json()
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}

export async function loadHomeBootstrap(apiBase) {
  const primaryPath = '/api/public/home-bootstrap?page=1&page_size=10&include_modules=false'
  let bootstrapResponse = null

  try {
    bootstrapResponse = await fetchJsonWithStatus(apiBase, primaryPath)
  } catch (error) {
    console.warn(`[prerender] home-bootstrap request failed, falling back to legacy public endpoints: ${error.message}`)
  }

  if (bootstrapResponse?.ok) {
    return bootstrapResponse.data
  }

  if (bootstrapResponse && bootstrapResponse.status !== 404) {
    throw new Error(`Failed to fetch ${primaryPath}: ${bootstrapResponse.status}`)
  }

  if (bootstrapResponse?.status === 404) {
    console.warn('[prerender] home-bootstrap unavailable, falling back to legacy public endpoints.')
  }

  const [settings, posts] = await Promise.all([
    fetchJson(apiBase, '/api/settings'),
    fetchJson(apiBase, '/api/posts?page=1&page_size=10'),
  ])

  return {
    settings,
    home_modules: {},
    posts,
  }
}

const META_DESCRIPTION_RE = /<meta name="description" content="[^"]*"\s*\/?>/i
const META_OG_TITLE_RE = /<meta property="og:title" content="[^"]*"\s*\/?>/i
const META_OG_DESCRIPTION_RE = /<meta property="og:description" content="[^"]*"\s*\/?>/i
const META_OG_URL_RE = /<meta property="og:url" content="[^"]*"\s*\/?>/i
const META_OG_IMAGE_RE = /<meta property="og:image" content="[^"]*"\s*\/?>\s*/i

/**
 * Replace a template marker with a literal string.
 *
 * `String.prototype.replace` interprets `$&`, "$`", `$'` and `$n` inside a *string*
 * replacement as substitution patterns, and `escapeHtml` deliberately does not escape
 * `$`. An article summary containing `$'` therefore used to splice the tail of the
 * template into the output — which closed the inline bootstrap script early and left
 * `window.__BLOG_BOOTSTRAP__` undefined. A function replacement is always taken
 * literally, so every injection below must go through this helper.
 *
 * The marker is also required by default: a silently skipped injection means the page
 * ships with the generic template metadata and nothing would ever turn red.
 */
function replaceMarker(html, pattern, replacement, label, { required = true } = {}) {
  const matched = typeof pattern === 'string' ? html.includes(pattern) : pattern.test(html)
  if (!matched) {
    if (!required) return html
    throw new Error(
      `[prerender] template marker ${label} not found — index.html and prerender-public.mjs are out of sync.`,
    )
  }
  return html.replace(pattern, () => replacement)
}

function injectTemplate(template, { routePath, title, description, rootHtml, siteUrl, image = '', extraHead = '', extraScript = '' }) {
  const canonical = canonicalUrl(siteUrl, encodeRoutePath(routePath))
  let html = template
  html = replaceMarker(html, /<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`, '<title>')
  html = replaceMarker(
    html,
    META_DESCRIPTION_RE,
    `<meta name="description" content="${escapeHtml(description)}">`,
    'meta[name=description]',
  )
  html = replaceMarker(
    html,
    META_OG_TITLE_RE,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    'meta[property=og:title]',
  )
  html = replaceMarker(
    html,
    META_OG_DESCRIPTION_RE,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    'meta[property=og:description]',
  )
  html = replaceMarker(
    html,
    META_OG_URL_RE,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    'meta[property=og:url]',
  )
  if (image) {
    html = html.includes('<meta property="og:image"')
      ? replaceMarker(
        html,
        META_OG_IMAGE_RE,
        `<meta property="og:image" content="${escapeHtml(image)}">`,
        'meta[property=og:image]',
      )
      : replaceMarker(html, '</head>', `<meta property="og:image" content="${escapeHtml(image)}">\n</head>`, '</head>')
  } else {
    // An empty og:image renders a blank social card, which is worse than no tag at all.
    html = replaceMarker(html, META_OG_IMAGE_RE, '', 'meta[property=og:image]', { required: false })
  }

  html = replaceMarker(
    html,
    '</head>',
    `${PRERENDER_STYLE}\n<link rel="canonical" href="${escapeHtml(canonical)}">\n${extraHead}\n</head>`,
    '</head>',
  )
  html = replaceMarker(
    html,
    '<div id="root"></div>',
    `<div id="root">${rootHtml}</div>${extraScript}`,
    '<div id="root">',
  )
  return html
}

/** Percent-encode each path segment for canonical URLs / hrefs (never for file paths). */
function encodeRoutePath(routePath) {
  const text = String(routePath || '')
  if (!text || text === '/') return text
  return text
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      let decoded = segment
      try {
        decoded = decodeURIComponent(segment)
      } catch {
        // Already-literal segment containing a stray `%`; encode it as-is.
      }
      return encodeURIComponent(decoded)
    })
    .join('/')
}

/**
 * Map a route path to its output file. Route paths reach this function in both raw and
 * percent-encoded form; the filesystem stores the *decoded* segment and Vercel matches
 * requests after decoding, so writing `topics/%E4%B8%AD` would silently fall through to
 * the SPA catch-all and serve the home page under that URL.
 */
export function routeOutputPath(routePath, baseDir = distDir) {
  const normalizedRoute = routePath === '/' ? '' : String(routePath || '').replace(/^\//, '')
  if (!normalizedRoute) return join(baseDir, 'index.html')

  const segments = normalizedRoute.split('/').map((segment) => {
    let decoded = segment
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      // Keep the raw segment when it is not valid percent-encoding.
    }
    if (decoded === '.' || decoded === '..' || /[\\/]/.test(decoded)) {
      throw new Error(`[prerender] refusing to write route with unsafe segment: ${routePath}`)
    }
    return decoded
  })

  return join(baseDir, ...segments, 'index.html')
}

async function writeRouteHtml(routePath, html) {
  const targetFile = routeOutputPath(routePath)
  await mkdir(dirname(targetFile), { recursive: true })
  await writeFile(targetFile, html, 'utf8')
}

function renderCard(item, href, meta = []) {
  const image = item?.cover_image
    ? `<img src="${escapeHtml(item.cover_image)}" alt="${escapeHtml(item.title || item.display_title || '')}" loading="lazy">`
    : '<div class="prerender-cover"></div>'
  const title = item?.title || item?.display_title || '未命名内容'
  const summary = item?.summary || item?.description || ''
  return `
    <a class="prerender-card" href="${escapeHtml(href)}">
      ${image}
      <h3>${escapeHtml(title)}</h3>
      <p class="prerender-summary">${escapeHtml(truncate(summary, 140))}</p>
      ${meta.length > 0 ? `<div class="prerender-meta">${meta.map((entry) => `<span>${escapeHtml(entry)}</span>`).join('')}</div>` : ''}
    </a>
  `
}

function renderListLinks(items, toHref, metaBuilder = () => []) {
  return `
    <div class="prerender-list">
      ${items.map((item) => `
        <a class="prerender-list-item" href="${escapeHtml(toHref(item))}">
          <div class="prerender-caption">${escapeHtml((item.content_type || '').replace('_', ' '))}</div>
          <h3>${escapeHtml(item.title || item.display_title || '')}</h3>
          <p class="prerender-summary">${escapeHtml(truncate(item.summary || item.description || '', 120))}</p>
          ${metaBuilder(item).length > 0 ? `<div class="prerender-meta">${metaBuilder(item).map((entry) => `<span>${escapeHtml(entry)}</span>`).join('')}</div>` : ''}
        </a>
      `).join('')}
    </div>
  `
}

export function renderHomePage(template, payload, siteUrl) {
  const posts = payload?.posts?.items || []
  const title = `${SITE_TITLE} | ${HOME_TITLE}`
  const description = HOME_DESCRIPTION
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Public First</span>
        <h1>${escapeHtml(HOME_TITLE)}</h1>
        <p class="prerender-lead">${escapeHtml(description)}</p>
        <div class="prerender-chip-row">
          <a class="prerender-chip" href="/topics">进入主题追踪</a>
          <a class="prerender-chip" href="/series">进入内容系列</a>
          <a class="prerender-chip" href="/archive">查看归档</a>
        </div>
      </section>

      <section class="prerender-section">
        <h2>最新文章</h2>
        <div class="prerender-grid cols-2">
          ${posts.slice(0, 6).map((post) => renderCard(post, `/posts/${post.slug}`, [
            post.coverage_date || formatDate(post.created_at),
            post.content_type || 'post',
          ])).join('')}
        </div>
      </section>

    </main>
  `
  return injectTemplate(
    template,
    {
      routePath: '/',
      title,
      description,
      rootHtml,
      siteUrl,
      image: payload?.settings?.hero_image || payload?.settings?.avatar_url || '',
      extraScript: bootstrapScript(payload),
    },
  )
}

function renderArchivePage(template, archiveGroups, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Archive</span>
        <h1>文章归档</h1>
        <p class="prerender-lead">按年份和日期快速浏览历史文章，先拿到可见内容，再由前端继续接管交互。</p>
      </section>
      ${(archiveGroups || []).map((group) => `
        <section class="prerender-section">
          <h2>${escapeHtml(group.year)} 年</h2>
          <div class="prerender-list">
            ${(group.posts || []).slice(0, 40).map((post) => `
              <a class="prerender-list-item" href="/posts/${escapeHtml(post.slug)}">
                <h3>${escapeHtml(post.title)}</h3>
                <div class="prerender-meta">
                  <span>${escapeHtml(post.coverage_date || formatDate(post.created_at))}</span>
                  <span>${escapeHtml(post.content_type || 'post')}</span>
                </div>
              </a>
            `).join('')}
          </div>
        </section>
      `).join('')}
    </main>
  `
  return injectTemplate(template, {
    routePath: '/archive',
    title: `文章归档 - ${SITE_TITLE}`,
    description: '按年份和日期快速浏览历史文章与栏目更新。',
    rootHtml,
    siteUrl,
  })
}

function renderSeriesListPage(template, seriesItems, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Series</span>
        <h1>内容系列</h1>
        <p class="prerender-lead">把日报、周报和专题文章组织成更适合连续阅读的栏目路径。</p>
      </section>
      <section class="prerender-section">
        <div class="prerender-grid cols-2">
          ${(seriesItems || []).map((series) => renderCard(series, `/series/${encodeURIComponent(series.slug)}`, [
            `${series.post_count || 0} 篇`,
            series.latest_post_at ? formatDate(series.latest_post_at) : '持续更新',
          ])).join('')}
        </div>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath: '/series',
    title: `内容系列 - ${SITE_TITLE}`,
    description: '沿着栏目路径继续阅读，把分散文章组织成长期阅读主线。',
    rootHtml,
    siteUrl,
  })
}

function renderTopicsListPage(template, topicItems, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Topics</span>
        <h1>主题追踪</h1>
        <p class="prerender-lead">围绕公司、模型、产品方向和事件链，把持续变化整理成稳定可回访的主题入口。</p>
      </section>
      <section class="prerender-section">
        <div class="prerender-grid cols-3">
          ${(topicItems || []).map((topic) => renderCard(topic, `/topics/${encodeURIComponent(topic.topic_key)}`, [
            `${topic.post_count || 0} 篇内容`,
            topic.latest_post_at ? formatDate(topic.latest_post_at) : '持续追踪',
          ])).join('')}
        </div>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath: '/topics',
    title: `主题追踪 - ${SITE_TITLE}`,
    description: '围绕长期变化构建主题入口，帮助陌生访客先看到可见内容。',
    rootHtml,
    siteUrl,
  })
}

function renderContentTypePage(template, routePath, title, description, items, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">${escapeHtml(routePath === '/weekly' ? 'Weekly' : 'Daily')}</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="prerender-lead">${escapeHtml(description)}</p>
      </section>
      <section class="prerender-section">
        <div class="prerender-grid cols-2">
          ${(items || []).map((item) => renderCard(item, `/posts/${item.slug}`, [
            item.coverage_date || formatDate(item.created_at),
            item.content_type || 'post',
          ])).join('')}
        </div>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${title} - ${SITE_TITLE}`,
    description,
    rootHtml,
    siteUrl,
  })
}

function renderSeriesDetailPage(template, series, siteUrl) {
  const posts = series?.posts || []
  const routePath = `/series/${encodeURIComponent(series.slug)}`
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Series Detail</span>
        <h1>${escapeHtml(series.title || series.slug)}</h1>
        <p class="prerender-lead">${escapeHtml(series.description || '沿着这条系列路径继续阅读。')}</p>
      </section>
      <section class="prerender-section">
        <h2>系列文章</h2>
        ${renderListLinks(posts, (item) => `/posts/${item.slug}`, (item) => [
          item.coverage_date || formatDate(item.created_at),
          item.content_type || 'post',
        ])}
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${series.title || series.slug} - ${SITE_TITLE}`,
    description: truncate(series.description || '系列文章集合页。', 150),
    rootHtml,
    siteUrl,
    image: series.cover_image || posts[0]?.cover_image || '',
  })
}

function renderTopicDetailPage(template, topic, siteUrl) {
  const posts = topic?.posts || topic?.recent_posts || []
  const routePath = `/topics/${encodeURIComponent(topic.topic_key || '')}`
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">Topic Detail</span>
        <h1>${escapeHtml(topic.display_title || topic.title || topic.topic_key)}</h1>
        <p class="prerender-lead">${escapeHtml(topic.description || '继续追踪这条主题主线的最近变化。')}</p>
        <div class="prerender-chip-row">
          <a class="prerender-chip" href="/feeds">打开订阅中心</a>
          <a class="prerender-chip" href="/series">查看相关系列</a>
        </div>
      </section>
      <section class="prerender-section">
        <h2>最近更新</h2>
        ${renderListLinks(posts, (item) => `/posts/${item.slug}`, (item) => [
          item.coverage_date || formatDate(item.created_at),
          item.content_type || 'post',
        ])}
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${topic.display_title || topic.title || topic.topic_key} - ${SITE_TITLE}`,
    description: truncate(topic.description || '主题详情页。', 150),
    rootHtml,
    siteUrl,
    image: topic.cover_image || posts[0]?.cover_image || '',
  })
}

export function renderPostDetailPage(template, post, siteUrl) {
  const routePath = `/posts/${encodeURIComponent(post.slug)}`
  const excerpt = truncate(stripMarkdown(post.content_md || post.summary || ''), 600)
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">${escapeHtml(post.content_type || 'Article')}</span>
        <h1>${escapeHtml(post.title)}</h1>
        <p class="prerender-lead">${escapeHtml(post.summary || excerpt)}</p>
        <div class="prerender-meta">
          <span>${escapeHtml(post.coverage_date || formatDate(post.created_at))}</span>
          ${post.topic_key ? `<span>${escapeHtml(post.topic_key)}</span>` : ''}
          ${post.series_slug ? `<span>${escapeHtml(post.series_slug)}</span>` : ''}
        </div>
      </section>
      <section class="prerender-section">
        ${post.cover_image ? `<img class="prerender-cover" src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(post.title)}">` : ''}
        <div class="prerender-panel">
          <h2>内容摘要</h2>
          <p class="prerender-summary">${escapeHtml(excerpt || post.summary || '这篇文章的详细内容会在前端接管后完整显示。')}</p>
        </div>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${post.title} - ${SITE_TITLE}`,
    description: truncate(post.summary || excerpt, 150),
    rootHtml,
    siteUrl,
    image: post.cover_image || '',
  })
}

export function renderStaticPage(template, { routePath, title, description, eyebrow = 'AI Intelligence Desk' }, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell">
      <section class="prerender-hero">
        <span class="prerender-kicker">${escapeHtml(eyebrow)}</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="prerender-lead">${escapeHtml(description)}</p>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${title} - ${SITE_TITLE}`,
    description,
    rootHtml,
    siteUrl,
  })
}

export function renderPrivateShell(template, { routePath, title, description, surface = 'auth' }, siteUrl) {
  const rootHtml = `
    <main class="prerender-shell prerender-private-shell" data-prerender-private="${escapeHtml(surface)}">
      <section class="prerender-hero">
        <span class="prerender-kicker">${surface === 'operations' ? 'Signal Desk Operations' : 'Signal Desk Identity'}</span>
        <h1>${escapeHtml(title)}</h1>
        <p class="prerender-lead">${escapeHtml(description)}</p>
      </section>
    </main>
  `
  return injectTemplate(template, {
    routePath,
    title: `${title} - ${SITE_TITLE}`,
    description,
    rootHtml,
    siteUrl,
    extraHead: '<meta name="robots" content="noindex,nofollow" data-surface-managed>',
  })
}

/**
 * Report how many detail pages a group actually produced and fail loudly when the
 * shortfall is large enough to matter. Anything not written here is served by the SPA
 * catch-all as the home page (HTTP 200, canonical pointing at `/`) — a soft 404 that no
 * exit code used to flag.
 */
function summarizeDetailCoverage(label, plural, expected, failures) {
  const generated = expected - failures.length
  if (failures.length > 0) {
    console.error(`[prerender] ${failures.length}/${expected} ${plural} detail fetches failed:`)
    failures.forEach(({ key, message }) => console.error(`[prerender]   - ${label}:${key} ${message}`))
  }
  const ratio = expected === 0 ? 1 : generated / expected
  return { label, plural, expected, generated, ratio, ok: ratio >= PRERENDER_MIN_DETAIL_RATIO }
}

function collectDetail(apiBase, path, failures, key) {
  return fetchJson(apiBase, path).catch((error) => {
    failures.push({ key, message: error?.message || 'unknown error' })
    return null
  })
}

export async function main({
  writeRoute = writeRouteHtml,
  readTemplate = () => readFile(templatePath, 'utf8'),
} = {}) {
  if (envFlag(process.env.SKIP_PRERENDER)) {
    console.warn('[prerender] explicitly skipped because SKIP_PRERENDER is enabled.')
    return
  }

  const apiBase = normalizeUrl(process.env.PRERENDER_API_BASE || process.env.VITE_API_BASE || '')
  const siteUrl = normalizeUrl(process.env.PUBLIC_SITE_URL || SITE_SEO.canonicalOrigin)

  if (!apiBase) {
    throw new Error(
      'PRERENDER_API_BASE or VITE_API_BASE is required. Set SKIP_PRERENDER=1 only for an intentional non-SSG build.',
    )
  }

  const template = await readTemplate()
  console.log(`[prerender] using api base ${apiBase}`)
  console.log(`[prerender] detail fetch concurrency ${PRERENDER_FETCH_CONCURRENCY}`)

  const homeBootstrap = await loadHomeBootstrap(apiBase)
  await writeRoute('/', renderHomePage(template, homeBootstrap, siteUrl))

  const [archiveGroups, topicsPayload, seriesList, dailyDiscover, weeklyDiscover] = await Promise.all([
    fetchJson(apiBase, '/api/archive'),
    fetchJson(apiBase, '/api/topics?limit=200'),
    fetchJson(apiBase, '/api/series?limit=100'),
    fetchJson(apiBase, '/api/discover?content_type=daily_brief&limit=24'),
    fetchJson(apiBase, '/api/discover?content_type=weekly_review&limit=24'),
  ])

  await writeRoute('/archive', renderArchivePage(template, archiveGroups, siteUrl))
  await writeRoute('/topics', renderTopicsListPage(template, topicsPayload?.items || [], siteUrl))
  await writeRoute('/series', renderSeriesListPage(template, Array.isArray(seriesList) ? seriesList : [], siteUrl))
  const staticRoutes = [
    ['/discover', '发现', '按内容类型、系列和关键词发现值得持续追踪的 AI 内容。'],
    ['/search', '搜索', '搜索文章、主题、系列与关键变化。'],
    ['/following', '追踪', '继续阅读并查看你关注的主题。'],
    ['/start-here', '开始阅读', '从今日信号、主题与系列开始建立 AI 阅读路径。'],
    ['/feeds', '订阅中心', '订阅主题、系列和内容更新。'],
    ['/tags', '标签', '按标签浏览 AI 文章与观察。'],
    ['/friends', '友链', '发现值得关注的技术与 AI 站点。'],
  ]
  await Promise.all(staticRoutes.map(([routePath, title, description]) =>
    writeRoute(routePath, renderStaticPage(template, { routePath, title, description }, siteUrl))))

  const privateRoutes = [
    ['/login', '登录', '登录后同步你的关注、阅读历史与互动记录。', 'auth'],
    ['/register', '注册', '建立你的 Signal Desk 阅读档案。', 'auth'],
    ['/forgot-password', '找回密码', '通过邮箱验证码安全恢复账号。', 'auth'],
    ['/reset-password', '重置密码', '验证邮箱后设置新的登录密码。', 'auth'],
    ['/verify-email', '邮箱验证', '确认邮箱归属并完善账号安全状态。', 'auth'],
    ['/account', '个人信号中心', '继续阅读、管理个人资料库、关注主题与账号安全。', 'auth'],
    ['/admin/login', '管理员登录', '进入 Signal Desk 运营驾驶舱。', 'operations'],
    ['/admin/dashboard', '管理控制台', 'Signal Desk 受保护的运营工作区。', 'operations'],
  ]
  await Promise.all(privateRoutes.map(([routePath, title, description, surface]) =>
    writeRoute(
      routePath,
      renderPrivateShell(template, { routePath, title, description, surface }, siteUrl),
    )))
  await writeRoute(
    '/daily',
    renderContentTypePage(
      template,
      '/daily',
      'AI 日报',
      '先看今天最值得继续追踪的消息和更新。',
      dailyDiscover?.items || [],
      siteUrl,
    ),
  )
  await writeRoute(
    '/weekly',
    renderContentTypePage(
      template,
      '/weekly',
      'AI 周报',
      '优先拿到一周关键变化的结构化总览。',
      weeklyDiscover?.items || [],
      siteUrl,
    ),
  )

  const archivePosts = (archiveGroups || []).flatMap((group) => group.posts || [])
  const topicItems = topicsPayload?.items || []
  const seriesItems = Array.isArray(seriesList) ? seriesList : []

  const topicFailures = []
  const seriesFailures = []
  const postFailures = []

  const [topicDetails, seriesDetails, postDetails] = await Promise.all([
    mapWithConcurrency(topicItems, PRERENDER_FETCH_CONCURRENCY, (topic) =>
      collectDetail(apiBase, `/api/topics/${encodeURIComponent(topic.topic_key)}`, topicFailures, topic.topic_key),
    ),
    mapWithConcurrency(seriesItems, PRERENDER_FETCH_CONCURRENCY, (series) =>
      collectDetail(apiBase, `/api/series/${encodeURIComponent(series.slug)}`, seriesFailures, series.slug),
    ),
    mapWithConcurrency(archivePosts, PRERENDER_FETCH_CONCURRENCY, (post) =>
      collectDetail(apiBase, `/api/posts/${encodeURIComponent(post.slug)}`, postFailures, post.slug),
    ),
  ])

  for (const topic of topicDetails.filter(Boolean)) {
    await writeRoute(
      `/topics/${encodeURIComponent(topic.topic_key)}`,
      renderTopicDetailPage(template, topic, siteUrl),
    )
  }

  for (const series of seriesDetails.filter(Boolean)) {
    await writeRoute(
      `/series/${encodeURIComponent(series.slug)}`,
      renderSeriesDetailPage(template, series, siteUrl),
    )
  }

  for (const post of postDetails.filter(Boolean)) {
    await writeRoute(
      `/posts/${encodeURIComponent(post.slug)}`,
      renderPostDetailPage(template, post, siteUrl),
    )
  }

  const coverage = [
    summarizeDetailCoverage('topic', 'topics', topicItems.length, topicFailures),
    summarizeDetailCoverage('series', 'series', seriesItems.length, seriesFailures),
    summarizeDetailCoverage('post', 'posts', archivePosts.length, postFailures),
  ]

  console.log(
    `[prerender] generated ${coverage.map(({ plural, generated, expected }) => `${generated}/${expected} ${plural}`).join(', ')}.`,
  )

  const degraded = coverage.filter(({ ok }) => !ok)
  if (degraded.length > 0) {
    throw new Error(
      `detail prerender coverage below ${Math.round(PRERENDER_MIN_DETAIL_RATIO * 100)}%: ${
        degraded.map(({ plural, generated, expected }) => `${plural} ${generated}/${expected}`).join(', ')
      }. Missing routes would be served as the home page (soft 404), so the build is failed on purpose.`,
    )
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[prerender] failed: ${error.message}`)
    process.exitCode = 1
  })
}
