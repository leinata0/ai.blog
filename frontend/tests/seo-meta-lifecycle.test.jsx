import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SeoMeta from '../src/components/SeoMeta'
import { SITE_CANONICAL_ORIGIN } from '../src/utils/contentPresentation'

const mocks = vi.hoisted(() => ({ settings: {} }))

vi.mock('../src/contexts/SiteContext', () => ({
  useSite: () => ({ settings: mocks.settings }),
}))

function canonicalHref() {
  return document.head.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null
}

function metaContent(selector) {
  return document.head.querySelector(selector)?.getAttribute('content') ?? null
}

beforeEach(() => {
  mocks.settings = {}
  document.head.innerHTML = ''
})

afterEach(cleanup)

describe('canonical host resolution', () => {
  it('prefers settings.site_url', () => {
    mocks.settings = { site_url: 'https://configured.example.com/' }
    render(<SeoMeta title="标题" description="描述" path="/tags" />)

    expect(canonicalHref()).toBe('https://configured.example.com/tags')
  })

  it('falls back to the canonical the prerendered HTML shipped, not location.origin', () => {
    // jsdom serves pages from http://localhost — the apex/preview equivalent of the bug.
    const prerendered = document.createElement('link')
    prerendered.setAttribute('rel', 'canonical')
    prerendered.setAttribute('href', 'https://www.563118077.xyz/posts/some-article')
    document.head.appendChild(prerendered)

    render(<SeoMeta title="标题" description="描述" path="/tags" />)

    expect(canonicalHref()).toBe('https://www.563118077.xyz/tags')
    expect(canonicalHref()).not.toContain('localhost')
  })

  it('falls back to the shared constant when nothing else is available', () => {
    render(<SeoMeta title="标题" description="描述" path="/tags" />)

    expect(canonicalHref()).toBe(`${SITE_CANONICAL_ORIGIN}/tags`)
  })
})

describe('managed head cleanup', () => {
  it('restores the previous canonical, description and og:image on unmount', () => {
    mocks.settings = { site_url: 'https://www.563118077.xyz' }
    document.head.innerHTML = `
      <meta name="description" content="站点默认描述">
      <meta property="og:image" content="https://cdn.example.com/default.png">
      <link rel="canonical" href="https://www.563118077.xyz/">
    `

    const view = render(
      <SeoMeta
        title="某篇文章"
        description="文章描述"
        path="/posts/some-article"
        image="https://cdn.example.com/article-cover.png"
      />,
    )

    expect(canonicalHref()).toBe('https://www.563118077.xyz/posts/some-article')
    expect(metaContent('meta[property="og:image"]')).toBe('https://cdn.example.com/article-cover.png')

    view.unmount()

    // Without restoration a page with no <SeoMeta> keeps the article's canonical/cover.
    expect(canonicalHref()).toBe('https://www.563118077.xyz/')
    expect(metaContent('meta[name="description"]')).toBe('站点默认描述')
    expect(metaContent('meta[property="og:image"]')).toBe('https://cdn.example.com/default.png')
  })

  it('removes its noindex directive again on unmount', () => {
    mocks.settings = { site_url: 'https://www.563118077.xyz' }
    const view = render(<SeoMeta title="404" description="未找到" path="/missing" noindex />)

    expect(metaContent('meta[name="robots"]')).toBe('noindex,follow')

    view.unmount()
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull()
  })
})

describe('effect stability', () => {
  it('does not rewrite the head on re-renders when no SEO prop changed', () => {
    mocks.settings = { site_url: 'https://www.563118077.xyz' }
    const appendSpy = vi.spyOn(document.head, 'appendChild')

    const view = render(<SeoMeta title="发现" description="描述" path="/discover" />)
    const initialCalls = appendSpy.mock.calls.length

    // A default `jsonLd = []` parameter used to allocate a new array per render, so this
    // effect re-ran on every keystroke of pages that hold an input.
    view.rerender(<SeoMeta title="发现" description="描述" path="/discover" />)
    view.rerender(<SeoMeta title="发现" description="描述" path="/discover" />)

    expect(appendSpy.mock.calls.length).toBe(initialCalls)
    appendSpy.mockRestore()
  })
})
