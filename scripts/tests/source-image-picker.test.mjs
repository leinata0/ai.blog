import test from 'node:test'
import assert from 'node:assert/strict'

import { extractImageCandidatesFromHtml, pickSourceImages } from '../lib/source-image-picker.mjs'

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

test('pickSourceImages prefers primary-source meta image as first fallback when section match is weak', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/hero.jpg">
        </head>
        <body>
          <img src="https://cdn.example.com/logo.png" alt="brand logo" width="80" height="40" />
        </body>
      </html>
    `,
  })

  try {
    const plans = await pickSourceImages({
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
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('pickSourceImages scores alt text and source title for section relevance', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => `
      <html>
        <body>
          <img src="https://cdn.example.com/agent-runtime.jpg" alt="agent runtime orchestration dashboard" width="1200" height="640" />
          <img src="https://cdn.example.com/other.jpg" alt="generic conference photo" width="1200" height="640" />
        </body>
      </html>
    `,
  })

  try {
    const plans = await pickSourceImages({
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
  } finally {
    globalThis.fetch = originalFetch
  }
})
