import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchAdminPostsByOffset, findAdminPostByExactSlug } from '../lib/blog-api.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('fetchAdminPostsByOffset translates arbitrary offsets into backend page queries', async () => {
  const calls = []
  const posts = Array.from({ length: 130 }, (_, index) => ({
    id: index + 1,
    slug: `post-${index + 1}`,
  }))
  const fetchImpl = async (url) => {
    calls.push(url)
    const parsed = new URL(url)
    const page = Number(parsed.searchParams.get('page'))
    const pageSize = Number(parsed.searchParams.get('page_size'))
    const start = (page - 1) * pageSize
    return jsonResponse({
      items: posts.slice(start, start + pageSize),
      total: posts.length,
    })
  }

  const result = await fetchAdminPostsByOffset({
    blogApiBase: 'https://blog.example',
    token: 'token',
    limit: 60,
    offset: 25,
    fetchImpl,
  })

  assert.equal(result.length, 60)
  assert.equal(result[0].id, 26)
  assert.equal(result.at(-1).id, 85)
  assert.deepEqual(
    calls.map((url) => new URL(url).search),
    ['?page=1&page_size=50', '?page=2&page_size=50'],
  )
})

test('findAdminPostByExactSlug scans admin pages and includes drafts', async () => {
  const posts = Array.from({ length: 55 }, (_, index) => ({
    id: index + 1,
    slug: index === 52 ? 'draft-target' : `post-${index + 1}`,
    is_published: index !== 52,
  }))
  const fetchImpl = async (url) => {
    const parsed = new URL(url)
    const page = Number(parsed.searchParams.get('page'))
    const pageSize = Number(parsed.searchParams.get('page_size'))
    const start = (page - 1) * pageSize
    return jsonResponse({
      items: posts.slice(start, start + pageSize),
      total: posts.length,
    })
  }

  const result = await findAdminPostByExactSlug({
    blogApiBase: 'https://blog.example',
    token: 'token',
    slug: 'draft-target',
    fetchImpl,
  })

  assert.equal(result?.id, 53)
  assert.equal(result?.is_published, false)
})
