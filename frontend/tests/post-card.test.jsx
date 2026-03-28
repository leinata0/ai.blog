import { describe, it, expect } from 'vitest'
import { normalizePostList } from '../src/api/posts'

describe('normalizePostList', () => {
  it('maps API list payload to UI-safe shape', () => {
    const out = normalizePostList({ items: [{ title: 't', slug: 's', summary: 'x', tags: [] }] })
    expect(out[0].slug).toBe('s')
  })
})
