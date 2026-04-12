import test from 'node:test'
import assert from 'node:assert/strict'

import { extractImageCandidatesFromHtml } from '../lib/source-image-picker.mjs'

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
