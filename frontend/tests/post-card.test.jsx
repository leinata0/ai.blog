import { describe, it, expect } from 'vitest'
import { normalizePostList } from '../src/api/posts'

describe('normalizePostList', () => {
  it('maps API list payload to UI-safe shape', () => {
    const out = normalizePostList({ items: [{ title: 't', slug: 's', summary: 'x', tags: [] }] })
    expect(out.items[0].slug).toBe('s')
    expect(out.total).toBe(0)
    expect(out.page).toBe(1)
    expect(out.page_size).toBe(10)
  })

  it('handles empty payload gracefully', () => {
    const out = normalizePostList({})
    expect(out.items).toEqual([])
    expect(out.total).toBe(0)
  })
})
