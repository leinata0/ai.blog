import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchExistingPostBySlug,
  resolveExistingCover,
} from '../publish-content-file.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('publisher searches every admin page for an exact slug', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (url.includes('page=1&')) {
      return jsonResponse({ items: [{ id: 1, slug: 'other' }], total: 2 })
    }
    return jsonResponse({ items: [{ id: 5, slug: 'target' }], total: 2 })
  }

  const result = await fetchExistingPostBySlug('target', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl,
    pageSize: 1,
  })

  assert.equal(result.id, 5)
  assert.equal(calls.length, 2)
})

test('publisher respects the admin API default page-size limit', async () => {
  let requestedUrl = ''
  await fetchExistingPostBySlug('missing', 'token', {
    blogApiBase: 'https://blog.example',
    fetchImpl: async (url) => {
      requestedUrl = url
      return jsonResponse({ items: [], total: 0 })
    },
  })

  assert.match(requestedUrl, /page_size=50$/)
})

test('publisher preserves an existing post cover', () => {
  assert.equal(
    resolveExistingCover({}, { cover_image: 'https://img.example/existing.jpg' }),
    'https://img.example/existing.jpg',
  )
  assert.equal(
    resolveExistingCover({ cover_image: 'https://img.example/article.jpg' }, { cover_image: 'old.jpg' }),
    'https://img.example/article.jpg',
  )
})
