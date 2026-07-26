import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractImageCandidatesFromHtml,
  extractImageCandidatesFromMarkdown,
  normalizeSectionTargets,
  pickSourceImages,
  tokenizeForMatching,
} from '../lib/source-image-picker.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(__dirname, '..', 'config', 'auto-blog.config.json')
// The shipped rules are part of the fix (blocklist / social-card segments), so the
// fixtures below are graded with the exact configuration production runs with.
const productionConfig = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
const productionRules = productionConfig.image_selection_rules

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const silentLogger = { warn() {}, log() {} }

function htmlResponder(htmlByUrl) {
  return async (url) => {
    const html = typeof htmlByUrl === 'string' ? htmlByUrl : htmlByUrl[String(url)]
    if (html === undefined) return new Response('missing', { status: 404 })
    return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } })
  }
}

function pick(options) {
  return pickSourceImages({
    fetchImpl: htmlResponder(options.html),
    pinAddresses: false,
    lookupImpl: publicLookup,
    logger: options.logger || silentLogger,
    ...options,
  })
}

function withProductionRules(overrides = {}) {
  return { image_selection_rules: { ...productionRules, ...overrides } }
}

// ---------------------------------------------------------------------------
// Fixtures modelled on the pages the 2026-07 duplicate-illustration incident hit.
// ---------------------------------------------------------------------------

// blog.google: one Gemini-generated share card reused across the whole blog,
// plus the article's own captioned figures.
const GOOGLE_BLOG_URL = 'https://blog.google/technology/ai/agent-runtime-update/'
const GOOGLE_SOCIAL_CARD = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dxu1k2dx.width-1300.png'
const GOOGLE_ARTICLE_IMAGE = 'https://storage.googleapis.com/gweb-uniblog-publish-prod/images/agent_runtime_diagram.width-1000.png'
const GOOGLE_BLOG_HTML = `<!doctype html>
<html><head>
  <meta property="og:image" content="${GOOGLE_SOCIAL_CARD}">
  <meta name="twitter:image" content="https://storage.googleapis.com/gweb-uniblog-publish-prod/images/Gemini_Generated_Image_k2dxu1k2dx.width-200.png">
</head>
<body>
  <header><img src="https://www.blog.google/static/blogv2/images/google-logo.svg" alt="Google" width="120" height="40"></header>
  <main>
    <article class="uni-blog-post">
      <figure class="article-image">
        <img src="${GOOGLE_ARTICLE_IMAGE}" alt="Diagram of the agent runtime" width="1000" height="560">
        <figcaption>The agent runtime routes every tool call through a policy check.</figcaption>
      </figure>
      <p>Body copy.</p>
    </article>
  </main>
</body></html>`

// huggingface.co/blog: the only image on the page is the per-org social thumbnail,
// which is why the same picture showed up in several posts.
const HUGGINGFACE_URL = 'https://huggingface.co/blog/nvidia/nemotron-nano'
const HUGGINGFACE_HTML = `<!doctype html>
<html><head>
  <meta property="og:image" content="https://cdn-thumbnails.huggingface.co/social-thumbnails/blog/nvidia/nemotron-nano.png">
</head>
<body><main><article><p>正文里的图片由前端脚本注入，静态 HTML 中没有任何 img。</p></article></main></body></html>`

// WordPress powered sites expose a base64 card generator as og:image; the URL
// contains none of the blocklist keywords.
const WORDPRESS_URL = 'https://sspai.com/post/98211'
const WORDPRESS_ARTICLE_IMAGE = 'https://rssfile.sspai.com/2026/07/24/model-context-router.jpg'
const WORDPRESS_HTML = `<!doctype html>
<html><head>
  <meta property="og:image" content="https://s0.wp.com/_si/?t=eyJpbWciOiJodHRwczovL2V4YW1wbGUuY29tL2NvdmVyLmpwZyIsInciOjEyMDAsImgiOjYzMH0">
  <meta name="twitter:image" content="https://s0.wp.com/_si?t=eyJpbWciOiJodHRwczovL2V4YW1wbGUuY29tL2NvdmVyLmpwZyJ9">
</head>
<body>
  <article class="post">
    <p>正文</p>
    <img class="wp-image-4821" src="${WORDPRESS_ARTICLE_IMAGE}" alt="模型上下文路由示意" width="1024" height="576">
  </article>
</body></html>`

// TechCrunch style responsive markup: the real illustration only exists in srcset.
const TECHCRUNCH_URL = 'https://techcrunch.com/2026/07/24/robotics-lab/'
const TECHCRUNCH_HTML = `<!doctype html>
<html><head>
  <meta property="og:image" content="https://techcrunch.com/wp-content/uploads/2026/07/default-social-card.jpg">
</head>
<body><main><article>
  <figure>
    <picture>
      <source type="image/webp" srcset="https://techcrunch.com/wp-content/uploads/2026/07/robotics-lab-300x169.webp 300w, https://techcrunch.com/wp-content/uploads/2026/07/robotics-lab-1536x864.webp 1536w">
      <img srcset="https://techcrunch.com/wp-content/uploads/2026/07/robotics-lab-768x432.jpg 768w, https://techcrunch.com/wp-content/uploads/2026/07/robotics-lab-2048x1152.jpg 2048w" alt="Robotics lab">
    </picture>
    <figcaption>Image Credits: Example</figcaption>
  </figure>
</article></main></body></html>`

test('extractImageCandidatesFromHtml reads meta and img tags', () => {
  const html = `
    <html>
      <head><meta property="og:image" content="/cover.jpg"></head>
      <body>
        <img src="/logo.png" alt="site logo" width="80" height="40" />
        <img src="/article.png" alt="agent architecture" width="800" height="420" />
      </body>
    </html>
  `

  const candidates = extractImageCandidatesFromHtml(html, 'https://example.com/post')

  assert.ok(candidates.some((item) => item.url === 'https://example.com/cover.jpg'))
  assert.ok(candidates.some((item) => item.url === 'https://example.com/article.png'))
})

test('extractImageCandidatesFromHtml records article / figure / caption placement', () => {
  const candidates = extractImageCandidatesFromHtml(GOOGLE_BLOG_HTML, GOOGLE_BLOG_URL)
  const inArticle = candidates.find((item) => item.url === GOOGLE_ARTICLE_IMAGE)
  const card = candidates.find((item) => item.url === GOOGLE_SOCIAL_CARD)

  assert.equal(inArticle.kind, 'inline-image')
  assert.equal(inArticle.inArticle, true)
  assert.equal(inArticle.inMain, true)
  assert.equal(inArticle.inFigure, true)
  assert.equal(inArticle.hasCaption, true)

  assert.equal(card.kind, 'meta-image')
  assert.equal(card.hasCaption, false)
})

test('empty or self-referential attributes never become candidates', () => {
  const pageUrl = 'https://example.com/2026/agent-runtime-orchestration'
  const html = `
    <meta property="og:image" content="">
    <meta name="twitter:image" content="#">
    <img alt="no source" width="1200" height="600">
    <img src="" alt="empty src">
    <img src="." alt="dot src">
  `

  const candidates = extractImageCandidatesFromHtml(html, pageUrl)

  // absoluteUrl(pageUrl, '') used to resolve to the page itself, and that fake
  // candidate outscored real images because the slug repeats the topic terms.
  assert.deepEqual(candidates.map((item) => item.url), [])
})

test('unquoted attribute values are parsed instead of yielding an empty attribute map', () => {
  const candidates = extractImageCandidatesFromHtml(
    '<img src=https://cdn.example.com/a.png alt=diagram width=1200 height=600>',
    'https://example.com/post',
  )

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].url, 'https://cdn.example.com/a.png')
  assert.equal(candidates[0].alt, 'diagram')
  assert.equal(candidates[0].width, 1200)
})

test('srcset on <img> and <picture><source> is understood, largest descriptor wins', () => {
  const html = `
    <picture>
      <source srcset="https://cdn.example.com/hero-480.webp 480w, https://cdn.example.com/hero-1600.webp 1600w" type="image/webp">
      <img srcset="https://cdn.example.com/hero-800.jpg 800w, https://cdn.example.com/hero-2000.jpg 2000w" alt="hero">
    </picture>
  `

  const urls = extractImageCandidatesFromHtml(html, 'https://example.com/post').map((item) => item.url)

  assert.ok(urls.includes('https://cdn.example.com/hero-1600.webp'))
  assert.ok(urls.includes('https://cdn.example.com/hero-2000.jpg'))
  assert.ok(!urls.includes('https://cdn.example.com/hero-480.webp'))
})

test('a captioned article figure beats the site-wide og:image share card', async () => {
  const plans = await pick({
    html: { [GOOGLE_BLOG_URL]: GOOGLE_BLOG_HTML },
    sections: ['## 智能体运行时的新变化'],
    topic: '智能体运行时',
    sourceItems: [{
      url: GOOGLE_BLOG_URL,
      title: 'A new agent runtime',
      source_name: 'Google Blog',
      is_primary: true,
    }],
    config: withProductionRules(),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, GOOGLE_ARTICLE_IMAGE)
  assert.notEqual(plans[0].image_url, GOOGLE_SOCIAL_CARD)
})

test('a page that only offers a share card yields no illustration at all', async () => {
  const warnings = []
  const plans = await pick({
    html: { [HUGGINGFACE_URL]: HUGGINGFACE_HTML },
    logger: { warn: (message) => warnings.push(message) },
    sections: ['## 模型发布'],
    topic: 'Nemotron Nano',
    sourceItems: [{
      url: HUGGINGFACE_URL,
      title: 'Nemotron Nano release',
      source_name: 'Hugging Face',
      is_primary: true,
    }],
    config: withProductionRules(),
  })

  // The fallback is enabled in production, so what saves this page is the share-card rule
  // itself: `/social-thumbnails/` is a per-org card that several posts share, and five
  // articles carrying one picture is a worse outcome than one article carrying none.
  assert.deepEqual(plans, [])
  assert.ok(warnings.some((message) => /found no in-article image/.test(message)))
})

test('social-thumbnail share cards stay blocked even when the meta fallback is enabled', async () => {
  const plans = await pick({
    html: { [HUGGINGFACE_URL]: HUGGINGFACE_HTML },
    sections: ['## 模型发布'],
    topic: 'Nemotron Nano',
    sourceItems: [{ url: HUGGINGFACE_URL, title: 'Nemotron Nano release', source_name: 'Hugging Face', is_primary: true }],
    config: withProductionRules({ allow_meta_image_fallback: true }),
  })

  assert.deepEqual(plans, [])
})

test('allow_meta_image_fallback re-enables a clean og:image when the page has no body image', async () => {
  const pageUrl = 'https://vendor.example.com/blog/inference-cache'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><head><meta property="og:image" content="https://cdn.vendor.example.com/posts/inference-cache-hero.png"></head>
        <body><main><article><p>没有正文图</p></article></main></body></html>`,
    },
    sections: ['## 推理缓存'],
    topic: 'inference cache',
    sourceItems: [{ url: pageUrl, title: 'Inference cache', source_name: 'Vendor Blog', is_primary: true }],
    config: withProductionRules({ allow_meta_image_fallback: true }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://cdn.vendor.example.com/posts/inference-cache-hero.png')
  assert.match(plans[0].reason, /meta_image_fallback/)
})

test('the base64 card generator endpoint never reaches the candidate pool', async () => {
  const plans = await pick({
    html: { [WORDPRESS_URL]: WORDPRESS_HTML },
    sections: ['## 上下文路由'],
    topic: '模型上下文路由',
    sourceItems: [{ url: WORDPRESS_URL, title: '模型上下文路由', source_name: '少数派', is_primary: true }],
    config: withProductionRules({ allow_meta_image_fallback: true }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, WORDPRESS_ARTICLE_IMAGE)
})

test('a query-only image endpoint is rejected while a long-id CDN url survives', async () => {
  const pageUrl = 'https://news.example.com/2026/07/agents'
  const generated = 'https://img.example.net/gen?t=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  const unsplash = 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?ixlib=rb-4.0.3&q=80&w=1080'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><body><main><article>
        <img src="${generated}" alt="generated card" width="1200" height="630">
        <img src="${unsplash}" alt="lab photo" width="1080" height="720">
      </article></main></body></html>`,
    },
    sections: ['## A', '## B'],
    topic: 'agents',
    sourceItems: [{ url: pageUrl, title: 'Agents', source_name: 'News', is_primary: true }],
    config: withProductionRules({ max_images: 2 }),
  })

  assert.deepEqual(plans.map((plan) => plan.image_url), [unsplash])
})

test('responsive srcset markup produces a real illustration rather than the default social card', async () => {
  const plans = await pick({
    html: { [TECHCRUNCH_URL]: TECHCRUNCH_HTML },
    sections: ['## 机器人实验室'],
    topic: 'robotics lab',
    sourceItems: [{ url: TECHCRUNCH_URL, title: 'Inside the robotics lab', source_name: 'TechCrunch', is_primary: true }],
    config: withProductionRules(),
  })

  assert.equal(plans.length, 1)
  assert.match(plans[0].image_url, /robotics-lab-(1536x864\.webp|2048x1152\.jpg|768x432\.jpg)$/)
  assert.ok(!plans[0].image_url.includes('default-social-card'))
  assert.ok(!plans[0].image_url.includes('300x169'))
})

test('a layout-sized width attribute does not disqualify the large srcset variant', async () => {
  const pageUrl = 'https://news.example.com/2026/07/inference'
  const large = 'https://cdn.example.com/2026/inference-stack-1600.jpg'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><body><main><article><figure>
        <img src="https://cdn.example.com/2026/inference-stack-200.jpg"
             srcset="https://cdn.example.com/2026/inference-stack-200.jpg 200w, ${large} 1600w"
             alt="inference stack" width="200" height="113">
        <figcaption>推理栈分层示意</figcaption>
      </figure></article></main></body></html>`,
    },
    sections: ['## 推理栈'],
    topic: 'inference stack',
    sourceItems: [{ url: pageUrl, title: 'Inference stack', source_name: 'News', is_primary: true }],
    config: withProductionRules(),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, large)
})

test('blocklist keywords match token boundaries instead of raw substrings', async () => {
  const pageUrl = 'https://lab.example.com/report'
  const downloadImage = 'https://cdn.example.com/downloads/model-architecture.png'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><body><main><article>
        <img src="https://cdn.example.com/ads/promo.png" alt="promo" width="1200" height="628">
        <img src="${downloadImage}" alt="model architecture" width="1200" height="640">
      </article></main></body></html>`,
    },
    sections: ['## 架构'],
    topic: 'model architecture',
    sourceItems: [{ url: pageUrl, title: 'Model architecture report', source_name: 'Lab', is_primary: true }],
    config: withProductionRules(),
  })

  // `ads` used to match the substring inside "downloads" and silently discard a
  // perfectly good diagram.
  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, downloadImage)
})

test('excludeUrls lets the caller keep an image from repeating across articles', async () => {
  const plans = await pick({
    html: { [GOOGLE_BLOG_URL]: GOOGLE_BLOG_HTML },
    sections: ['## 智能体运行时的新变化'],
    topic: '智能体运行时',
    sourceItems: [{ url: GOOGLE_BLOG_URL, title: 'A new agent runtime', source_name: 'Google Blog', is_primary: true }],
    config: withProductionRules(),
    excludeUrls: [GOOGLE_ARTICLE_IMAGE],
  })

  assert.deepEqual(plans, [])
})

test('pickSourceImages scores alt text and source title for section relevance', async () => {
  const plans = await pick({
    html: `
      <html>
        <body>
          <img src="https://cdn.example.com/agent-runtime.jpg" alt="agent runtime orchestration dashboard" width="1200" height="640" />
          <img src="https://cdn.example.com/other.jpg" alt="generic conference photo" width="1200" height="640" />
        </body>
      </html>
    `,
    sections: ['## Agent Runtime'],
    topic: 'agent orchestration',
    sourceItems: [
      {
        url: 'https://example.com/post',
        title: 'Agent runtime orchestration update',
        source_name: 'Vendor Blog',
        summary: 'runtime improvements',
        is_primary: false,
      },
    ],
    config: {
      image_selection_rules: {
        min_width: 0,
        min_height: 0,
        max_images: 1,
        blocklist_keywords: [],
      },
    },
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://cdn.example.com/agent-runtime.jpg')
})

test('a page whose og:image is empty does not burn an image slot on the page URL', async () => {
  const pageUrl = 'https://example.com/2026/agent-runtime-orchestration'
  const plans = await pick({
    html: {
      [pageUrl]: `
        <head><meta property="og:image" content=""></head>
        <body><img src="https://cdn.example.com/agent-runtime-diagram.png" alt="agent runtime orchestration" width="1200" height="640"></body>
      `,
    },
    sections: ['## Agent Runtime Orchestration'],
    topic: 'agent runtime orchestration',
    sourceItems: [{
      url: pageUrl,
      title: 'Agent runtime orchestration',
      source_name: 'Vendor Blog',
      is_primary: true,
    }],
    config: { image_selection_rules: { min_width: 0, min_height: 0, max_images: 1, blocklist_keywords: [] } },
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://cdn.example.com/agent-runtime-diagram.png')
})

test('unreadable source pages are logged instead of silently skipped', async () => {
  const warnings = []
  const plans = await pick({
    html: {},
    logger: { warn: (message) => warnings.push(message) },
    sections: ['## Section'],
    topic: 'topic',
    sourceItems: [{ url: 'https://example.com/down', title: 'Down', source_name: 'Down' }],
    config: { image_selection_rules: { min_width: 0, min_height: 0, max_images: 1, blocklist_keywords: [] } },
  })

  assert.equal(plans.length, 0)
  assert.match(warnings[0], /skipped source page \(https:\/\/example\.com\/down\).*image-page:404/)
  assert.match(warnings.at(-1), /could not read 1\/1 source page/)
})

test('oversized source HTML is rejected instead of being read into memory', async () => {
  const warnings = []
  const plans = await pick({
    html: `<html>${'<p>padding</p>'.repeat(200)}</html>`,
    logger: { warn: (message) => warnings.push(message) },
    maxHtmlBytes: 128,
    sections: ['## Section'],
    topic: 'topic',
    sourceItems: [{ url: 'https://example.com/huge', title: 'Huge', source_name: 'Huge' }],
    config: { image_selection_rules: { min_width: 0, min_height: 0, max_images: 1, blocklist_keywords: [] } },
  })

  assert.equal(plans.length, 0)
  assert.match(warnings[0], /exceeds 128 byte limit/)
})

test('the shipped configuration keeps share-card defences enabled', () => {
  assert.equal(productionConfig.source_image_picker_enabled, true)
  // The share-card defences are URL-shape rules and are what actually stop a social card;
  // they hold whatever allow_meta_image_fallback is set to. Those are the invariants.
  assert.ok(productionRules.blocklist_keywords.includes('social'))
  assert.ok(productionRules.social_card_path_segments.includes('social-thumbnails'))
  assert.ok(productionRules.social_card_path_segments.includes('_si'))
  assert.equal(productionRules.reject_generated_card_endpoints, true)
})

test('the shipped configuration aims for coverage rather than for the empty set', () => {
  // Turning the fallback off cut production from 38 illustrations across 25 posts to 14.
  // With cross-article de-duplication in place a cover picture can be published at most
  // once, so "an article may use its own cover when its body renders client-side" is
  // affordable again — and it is the only image many vendor blogs expose in static HTML.
  assert.equal(productionRules.allow_meta_image_fallback, true)
  assert.ok(productionRules.min_images_target >= 2, 'articles should aim for 2-3 illustrations')
  assert.ok(productionRules.max_images >= productionRules.min_images_target)
})

// ---------------------------------------------------------------------------
// 相关性：中文章节标题和英文图片 URL 之间没有词面桥梁，只有"来源归属"这一条结构桥。
// ---------------------------------------------------------------------------

test('tokenizeForMatching splits Chinese into bigrams instead of one giant token', () => {
  // 这是相关性打分从来没生效过的直接原因：旧正则把整串连续汉字并成一个 token，
  // 17 个字的章节标题拿去 includes() 永远命中 0。
  const terms = tokenizeForMatching('材料瓶颈正在成为下一代AI的硬约束')
  assert.ok(terms.length > 1, `expected bigrams, got ${JSON.stringify(terms)}`)
  assert.ok(terms.includes('材料'))
  assert.ok(terms.includes('瓶颈'))
  assert.ok(!terms.some((term) => term.length > 2))
  // "AI" 只有两个字母，正是过去唯一"蒙对"的那个命中来源，现在一并丢弃。
  assert.ok(!terms.includes('ai'))
})

test('tokenizeForMatching keeps English words and drops CDN path noise', () => {
  assert.deepEqual(tokenizeForMatching('Agent Runtime Orchestration'), ['agent', 'runtime', 'orchestration'])
  const urlTerms = tokenizeForMatching('https://cdn.example.com/2026/07/photo.jpg')
  for (const noise of ['com', 'cdn', 'jpg', 'photo', '2026', 'https']) {
    assert.ok(!urlTerms.includes(noise), `${noise} should not count as a relevance term`)
  }
})

test('normalizeSectionTargets accepts plain strings and digs source IDs out of free text', () => {
  const [plain, attributed] = normalizeSectionTargets([
    '## 只有标题',
    { heading: '## 有归属', must_use_sources: ['S2'], source_focus: '以 S5 为主，辅以背景材料' },
  ])
  assert.equal(plain.heading, '## 只有标题')
  assert.equal(plain.sourceIds.size, 0)
  assert.equal(attributed.heading, '## 有归属')
  assert.deepEqual([...attributed.sourceIds].sort(), ['s2', 's5'])
})

// Two source pages. S1 carries the structurally stronger picture (captioned figure inside
// <article>); S2 carries a plainer in-article photo. Nothing in either URL shares a word
// with the Chinese heading — which is the situation on every article we actually publish.
const CHIP_PAGE = 'https://vendor.example.com/chip-launch'
const CHIP_IMAGE = 'https://cdn.vendor.example.com/2026/chip-launch-diagram.jpg'
const CHIP_HTML = `<html><body><main><article>
  <figure>
    <img src="${CHIP_IMAGE}" alt="chip launch diagram" width="1200" height="630">
    <figcaption>The new inference chip</figcaption>
  </figure>
</article></main></body></html>`

const WAFER_PAGE = 'https://lab.example.com/materials-report'
const WAFER_IMAGE = 'https://cdn.lab.example.com/2026/wafer-supply.jpg'
const WAFER_HTML = `<html><body><main><article>
  <img src="${WAFER_IMAGE}" alt="wafer supply" width="900" height="500">
</article></main></body></html>`

const TWO_SOURCES = [
  { url: CHIP_PAGE, source_id: 'S1', title: 'Vendor ships a new inference chip', source_name: 'Vendor Blog', is_primary: true },
  { url: WAFER_PAGE, source_id: 'S2', title: 'Wafer supply constraints hit advanced packaging', source_name: 'Lab Report', is_primary: false },
]

function pickTwoSources(sections, overrides = { max_images: 1 }) {
  return pick({
    html: { [CHIP_PAGE]: CHIP_HTML, [WAFER_PAGE]: WAFER_HTML },
    sections,
    topic: '下一代AI的材料瓶颈',
    sourceItems: TWO_SOURCES,
    config: withProductionRules(overrides),
  })
}

test('without attribution the structurally strongest picture wins, whatever the section says', async () => {
  // Baseline for the test below: no word-level signal can separate these two, so the
  // captioned figure wins purely on markup — even for a section that is about wafers.
  const plans = await pickTwoSources(['## 材料瓶颈正在成为下一代AI的硬约束'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, CHIP_IMAGE)
})

test('a section takes its picture from the source it actually cites', async () => {
  // The fix. The section is written from S2, so it gets S2's picture even though S1's is
  // the better-marked-up image on paper. This is the only signal that survives the
  // Chinese-heading / English-URL language gap, and it is free: the outline already
  // records which sources each chapter was built from.
  const plans = await pickTwoSources([
    { heading: '## 材料瓶颈正在成为下一代AI的硬约束', source_ids: ['S2'] },
  ])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, WAFER_IMAGE)
  assert.equal(plans[0].source_id, 'S2')
  assert.match(plans[0].reason, /^section_source:S2$/)
})

test('attribution also works from a URL or outlet-name hint rather than an S-id', async () => {
  const plans = await pickTwoSources([
    { heading: '## 材料瓶颈', must_use_sources: ['https://lab.example.com/materials-report'] },
  ])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, WAFER_IMAGE)
})

test('attribution is a preference, not a filter: an empty-handed source falls through', async () => {
  // S7 is not among the sources at all (a stale or hallucinated ID). The article must not
  // lose its illustration over that — every candidate is merely demoted, so the best one
  // still clears the bar.
  const plans = await pickTwoSources([
    { heading: '## 材料瓶颈正在成为下一代AI的硬约束', source_ids: ['S7'] },
  ])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, CHIP_IMAGE)
})

test('two attributed sections take two different pictures, one per cited source', async () => {
  const plans = await pickTwoSources([
    { heading: '## 芯片这边发生了什么', source_ids: ['S1'] },
    { heading: '## 材料瓶颈正在成为下一代AI的硬约束', source_ids: ['S2'] },
  ], {})

  assert.deepEqual(plans.map((plan) => plan.image_url), [CHIP_IMAGE, WAFER_IMAGE])
})

// ---------------------------------------------------------------------------
// 版式：过扁的多半是站头/横幅
// ---------------------------------------------------------------------------

test('a 1456x180 banner loses to a normally proportioned article image', async () => {
  const pageUrl = 'https://news.example.com/2026/07/stack'
  const banner = 'https://cdn.example.com/2026/site-strip.png'
  const article = 'https://cdn.example.com/2026/stack-overview.png'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><body><main><article>
        <img src="${banner}" alt="strip" width="1456" height="180">
        <img src="${article}" alt="stack overview" width="1200" height="630">
      </article></main></body></html>`,
    },
    sections: ['## 分层'],
    topic: 'stack overview',
    sourceItems: [{ url: pageUrl, source_id: 'S1', title: 'The stack overview', source_name: 'News' }],
    config: withProductionRules({ max_images: 1 }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, article)
})

// ---------------------------------------------------------------------------
// 覆盖率：把已经花钱拿到、却被直接丢掉的两个图源接回来
// ---------------------------------------------------------------------------

test('images inside the Jina markdown full text are used, not thrown away', async () => {
  // jinaRead() already fetches every source as markdown and the pipeline pays for it, but
  // the `![](...)` links were dropped and only the prose kept. For a page whose body is
  // rendered client-side that markdown is the only place a real illustration exists.
  const pageUrl = 'https://vendor.example.com/blog/router'
  const diagram = 'https://cdn.vendor.example.com/2026/router-diagram-1200x630.png'
  const plans = await pick({
    html: {
      [pageUrl]: `<html><head><meta property="og:image" content="https://cdn.vendor.example.com/social/og-card.png"></head>
        <body><main><article><p>body rendered client-side</p></article></main></body></html>`,
    },
    sections: ['## 路由'],
    topic: 'model context router',
    sourceItems: [{
      url: pageUrl,
      source_id: 'S1',
      title: 'Model context router',
      source_name: 'Vendor Blog',
      content_markdown: `# Model context router\n\n![Router topology](${diagram})\n\nSome prose.`,
    }],
    config: withProductionRules({ max_images: 1 }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, diagram)
  assert.equal(plans[0].alt_text, 'Router topology')
})

test('RSS content:encoded still yields images when the source page cannot be fetched', async () => {
  // A dead / blocked / paywalled page used to cost the article every illustration, even
  // though the feed had already shipped the body with its pictures inside it.
  const pageUrl = 'https://news.example.com/2026/07/agents'
  const inline = 'https://cdn.example.com/2026/agent-loop.png'
  const warnings = []
  const plans = await pick({
    html: {},
    logger: { warn: (message) => warnings.push(String(message)), log() {} },
    sections: ['## 智能体循环'],
    topic: 'agent loop',
    sourceItems: [{
      url: pageUrl,
      source_id: 'S1',
      title: 'Inside the agent loop',
      source_name: 'News',
      content_html: `<p>正文</p><img src="${inline}" alt="agent loop" width="1200" height="630"><p>更多</p>`,
    }],
    config: withProductionRules({ max_images: 1 }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, inline)
  assert.ok(warnings.some((message) => /image-page:404/.test(message)))
})

test('candidates extracted by the caller are accepted but still screened', async () => {
  // lib/feed-media.mjs builds these from content:encoded / media:content. The picker takes
  // their provenance at face value and nothing else: the share card in the list below is
  // dropped by exactly the same rules that guard a scraped page.
  const pageUrl = 'https://vendor.example.com/blog/launch'
  const real = 'https://cdn.vendor.example.com/2026/launch-architecture.png'
  const plans = await pick({
    html: { [pageUrl]: '<html><body><main><article><p>body</p></article></main></body></html>' },
    sections: ['## 架构'],
    topic: 'launch architecture',
    sourceItems: [{
      url: pageUrl,
      source_id: 'S1',
      title: 'Launch architecture',
      source_name: 'Vendor',
      image_candidates: [
        { url: 'https://cdn.vendor.example.com/social-cards/launch.png', kind: 'feed-content', width: 1200, height: 630 },
        { url: real, kind: 'feed-content', caption: '架构示意', width: 1200, height: 630 },
      ],
    }],
    config: withProductionRules({ max_images: 1 }),
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, real)
  assert.equal(plans[0].alt_text, '架构示意')
})

test('feed-body images are treated as in-article, because that is what they are', () => {
  const candidates = extractImageCandidatesFromMarkdown(
    '![chart](https://cdn.example.com/a.png)\n\n[ref]: https://cdn.example.com/b.png\n\n![second][ref]',
    'https://news.example.com/post',
  )
  assert.deepEqual(candidates.map((item) => item.url), [
    'https://cdn.example.com/a.png',
    'https://cdn.example.com/b.png',
  ])
  assert.ok(candidates.every((item) => item.inArticle && item.inMain && item.kind === 'inline-image'))
})

test('a share card arriving through the feed body is blocked exactly like one scraped off the page', async () => {
  const pageUrl = 'https://vendor.example.com/blog/release'
  const plans = await pick({
    html: { [pageUrl]: '<html><body><main><article><p>body</p></article></main></body></html>' },
    sections: ['## 发布'],
    topic: 'release',
    sourceItems: [{
      url: pageUrl,
      source_id: 'S1',
      title: 'Release notes',
      source_name: 'Vendor',
      content_markdown: [
        '![](https://cdn-thumbnails.huggingface.co/social-thumbnails/blog/vendor/release.png)',
        '![](https://s0.wp.com/_si/?t=eyJpbWciOiJodHRwczovL2V4YW1wbGUuY29tL2NvdmVyLmpwZyJ9)',
        '![](https://cdn.vendor.example.com/assets/og-image/release.png)',
      ].join('\n\n'),
    }],
    config: withProductionRules(),
  })

  assert.deepEqual(plans, [])
})

test('the second section can still use a clean fallback, so an article is not stuck at one image', async () => {
  // Under the previous rule the fallback tiers only fired while the article had *zero*
  // pictures, so a run that found one good image could never reach two. min_images_target
  // is the knob that turns "at least one" into "aim for two".
  const richPage = 'https://news.example.com/2026/07/chips'
  const thinPage = 'https://vendor.example.com/blog/announcement'
  const bodyImage = 'https://cdn.example.com/2026/fab-line.jpg'
  const vendorCover = 'https://cdn.vendor.example.com/posts/announcement-hero.png'
  const plans = await pick({
    html: {
      [richPage]: `<html><body><main><article><figure>
          <img src="${bodyImage}" alt="fab line" width="1200" height="630"><figcaption>产线</figcaption>
        </figure></article></main></body></html>`,
      [thinPage]: `<html><head><meta property="og:image" content="${vendorCover}"></head>
        <body><main><article><p>client-side body</p></article></main></body></html>`,
    },
    sections: ['## 产能', '## 官方说法', '## 展望'],
    topic: 'fab capacity',
    sourceItems: [
      { url: richPage, source_id: 'S1', title: 'Inside the fab line', source_name: 'News', is_primary: true },
      { url: thinPage, source_id: 'S2', title: 'Vendor announcement', source_name: 'Vendor' },
    ],
    config: withProductionRules(),
  })

  assert.deepEqual(plans.map((plan) => plan.image_url), [bodyImage, vendorCover])
  assert.match(plans[1].reason, /meta_image_fallback/)
  // ...and it stops there: the third section has to earn a real content image.
  assert.equal(plans.length, 2)
})

test('when several sources have pictures, sections spread across them on a tie', async () => {
  const pageA = 'https://a.example.com/post'
  const pageB = 'https://b.example.com/post'
  const first = 'https://cdn.a.example.com/2026/one.jpg'
  const second = 'https://cdn.a.example.com/2026/two.jpg'
  const third = 'https://cdn.b.example.com/2026/three.jpg'
  const figure = (url, alt) => `<figure><img src="${url}" alt="${alt}" width="1200" height="630"><figcaption>c</figcaption></figure>`
  const plans = await pick({
    html: {
      [pageA]: `<html><body><main><article>${figure(first, 'one')}${figure(second, 'two')}</article></main></body></html>`,
      [pageB]: `<html><body><main><article>${figure(third, 'three')}</article></main></body></html>`,
    },
    sections: ['## 一', '## 二'],
    topic: 'spread',
    sourceItems: [
      { url: pageA, source_id: 'S1', source_name: 'A', title: 'A' },
      { url: pageB, source_id: 'S2', source_name: 'B', title: 'B' },
    ],
    config: withProductionRules({ max_images: 2 }),
  })

  assert.equal(plans.length, 2)
  assert.notEqual(plans[0].source_page_url, plans[1].source_page_url)
})
