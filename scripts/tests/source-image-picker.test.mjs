import test from 'node:test'
import assert from 'node:assert/strict'

import { extractImageCandidatesFromHtml, pickSourceImages } from '../lib/source-image-picker.mjs'

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

test('pickSourceImages prefers primary-source meta image as first fallback when section match is weak', async () => {
  const plans = await pick({
    html: `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/hero.jpg">
        </head>
        <body>
          <img src="https://cdn.example.com/logo.png" alt="brand logo" width="80" height="40" />
        </body>
      </html>
    `,
    sections: ['## 为什么值得关注'],
    topic: 'privacy trust ux',
    sourceItems: [
      {
        url: 'https://example.com/post',
        title: 'Privacy-led UX strategy',
        source_name: 'OpenAI Blog',
        summary: 'Trust and privacy product changes',
        is_primary: true,
      },
    ],
    config: {
      image_selection_rules: {
        min_width: 0,
        min_height: 0,
        max_images: 1,
        blocklist_keywords: ['logo'],
      },
    },
  })

  assert.equal(plans.length, 1)
  assert.equal(plans[0].image_url, 'https://cdn.example.com/hero.jpg')
  assert.match(plans[0].reason, /primary_hero_fallback|matched/)
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
