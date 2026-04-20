#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const distDir = resolve(__dirname, '..', 'dist')
const templatePath = join(distDir, 'index.html')

const SITE_TITLE = 'AI 资讯观察'
const HOME_TITLE = '持续更新 AI 最新动态与关键变化的中文博客'
const HOME_DESCRIPTION = '聚焦值得持续追踪的消息、产品更新与产业线索，用更清晰的结构整理每一天和每一周的重要变化。'
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

function formatDate(value) {
  const text = String(value || '').trim()
  if (!text) return '持续更新'
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00` : text)
  if (Number.isNaN(parsed.getTime())) return text
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(parsed)
}

function canonicalUrl(siteUrl, routePath) {
  if (!siteUrl) return routePath || '/'
  if (!routePath || routePath === '/') return siteUrl
  return `${siteUrl}${routePath}`
}

function bootstrapScript(payload) {
  if (!payload) return ''
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c')
  return `<script>window.__BLOG_BOOTSTRAP__=${serialized};</script>`
}

async function fetchJson(apiBase, path) {
  const response = await fetch(`${apiBase}${path}`, {
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
  const response = await fetch(`${apiBase}${path}`, {
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
  const primaryPath = '/api/public/home-bootstrap?page=1&page_size=10'
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

  const [settings, homeModules, posts] = await Promise.all([
    fetchJson(apiBase, '/api/settings'),
    fetchJson(apiBase, '/api/home/modules'),
    fetchJson(apiBase, '/api/posts?page=1&page_size=10'),
  ])

  return {
    settings,
    home_modules: homeModules,
    posts,
  }
}

function injectTemplate(template, { routePath, title, description, rootHtml, siteUrl, image = '', extraHead = '', extraScript = '' }) {
  const canonical = canonicalUrl(siteUrl, routePath)
  let html = template
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  html = html.replace(
    /<meta name="description" content="[^"]*">/i,
    `<meta name="description" content="${escapeHtml(description)}">`,
  )
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/i,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
  )
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/i,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
  )
  html = html.replace(
    /<meta property="og:url" content="[^"]*">/i,
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
  )
  if (html.includes('<meta property="og:image"')) {
    html = html.replace(
      /<meta property="og:image" content="[^"]*">/i,
      `<meta property="og:image" content="${escapeHtml(image || '')}">`,
    )
  } else if (image) {
    html = html.replace('</head>', `<meta property="og:image" content="${escapeHtml(image)}">\n</head>`)
  }

  html = html.replace('</head>', `${PRERENDER_STYLE}\n<link rel="canonical" href="${escapeHtml(canonical)}">\n${extraHead}\n</head>`)
  html = html.replace('<div id="root"></div>', `<div id="root">${rootHtml}</div>${extraScript}`)
  return html
}

async function writeRouteHtml(routePath, html) {
  const normalizedRoute = routePath === '/' ? '' : routePath.replace(/^\//, '')
  const targetFile = normalizedRoute
    ? join(distDir, normalizedRoute, 'index.html')
    : join(distDir, 'index.html')
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

function renderHomePage(template, payload, siteUrl) {
  const posts = payload?.posts?.items || []
  const modules = payload?.home_modules || {}
  const featuredTopics = modules?.topic_pulse?.items || []
  const featuredSeries = modules?.featured_series || []
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

      <section class="prerender-section">
        <h2>推荐主题</h2>
        <div class="prerender-grid cols-3">
          ${featuredTopics.slice(0, 6).map((topic) => renderCard(topic, `/topics/${encodeURIComponent(topic.topic_key)}`, [
            `${topic.post_count || 0} 篇内容`,
            topic.latest_post_at ? `最近更新 ${formatDate(topic.latest_post_at)}` : '持续追踪',
          ])).join('')}
        </div>
      </section>

      <section class="prerender-section">
        <h2>内容系列</h2>
        <div class="prerender-grid cols-2">
          ${featuredSeries.slice(0, 4).map((series) => renderCard(series, `/series/${series.slug}`, [
            `${series.post_count || 0} 篇`,
            series.latest_post_at ? formatDate(series.latest_post_at) : '持续更新',
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
      image: modules?.hero?.image || payload?.settings?.hero_image || '',
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
          ${(seriesItems || []).map((series) => renderCard(series, `/series/${series.slug}`, [
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
  const routePath = `/series/${series.slug}`
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

function renderPostDetailPage(template, post, siteUrl) {
  const routePath = `/posts/${post.slug}`
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

export async function main() {
  const template = await readFile(templatePath, 'utf8')
  const apiBase = normalizeUrl(process.env.PRERENDER_API_BASE || process.env.VITE_API_BASE || '')
  const siteUrl = normalizeUrl(process.env.PUBLIC_SITE_URL || 'https://563118077.xyz')

  if (!apiBase) {
    console.warn('[prerender] skipped because PRERENDER_API_BASE or VITE_API_BASE is not configured.')
    return
  }

  console.log(`[prerender] using api base ${apiBase}`)

  const homeBootstrap = await loadHomeBootstrap(apiBase)
  await writeRouteHtml('/', renderHomePage(template, homeBootstrap, siteUrl))

  const [archiveGroups, topicsPayload, seriesList, dailyDiscover, weeklyDiscover] = await Promise.all([
    fetchJson(apiBase, '/api/archive'),
    fetchJson(apiBase, '/api/topics?limit=200'),
    fetchJson(apiBase, '/api/series?limit=100'),
    fetchJson(apiBase, '/api/discover?content_type=daily_brief&limit=24'),
    fetchJson(apiBase, '/api/discover?content_type=weekly_review&limit=24'),
  ])

  await writeRouteHtml('/archive', renderArchivePage(template, archiveGroups, siteUrl))
  await writeRouteHtml('/topics', renderTopicsListPage(template, topicsPayload?.items || [], siteUrl))
  await writeRouteHtml('/series', renderSeriesListPage(template, Array.isArray(seriesList) ? seriesList : [], siteUrl))
  await writeRouteHtml(
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
  await writeRouteHtml(
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

  const [topicDetails, seriesDetails, postDetails] = await Promise.all([
    Promise.all(
      topicItems.map((topic) =>
        fetchJson(apiBase, `/api/topics/${encodeURIComponent(topic.topic_key)}`).catch(() => null),
      ),
    ),
    Promise.all(
      seriesItems.map((series) =>
        fetchJson(apiBase, `/api/series/${encodeURIComponent(series.slug)}`).catch(() => null),
      ),
    ),
    Promise.all(
      archivePosts.map((post) =>
        fetchJson(apiBase, `/api/posts/${encodeURIComponent(post.slug)}`).catch(() => null),
      ),
    ),
  ])

  for (const topic of topicDetails.filter(Boolean)) {
    await writeRouteHtml(
      `/topics/${encodeURIComponent(topic.topic_key)}`,
      renderTopicDetailPage(template, topic, siteUrl),
    )
  }

  for (const series of seriesDetails.filter(Boolean)) {
    await writeRouteHtml(
      `/series/${series.slug}`,
      renderSeriesDetailPage(template, series, siteUrl),
    )
  }

  for (const post of postDetails.filter(Boolean)) {
    await writeRouteHtml(
      `/posts/${post.slug}`,
      renderPostDetailPage(template, post, siteUrl),
    )
  }

  console.log(
    `[prerender] generated ${topicDetails.filter(Boolean).length} topics, ${seriesDetails.filter(Boolean).length} series, ${postDetails.filter(Boolean).length} posts.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[prerender] failed: ${error.message}`)
    process.exitCode = 1
  })
}
